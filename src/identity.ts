import { and, eq, inArray } from "drizzle-orm";
import type { BootstrapPermissionGrant } from "./config.js";
import type { Database } from "./database/client.js";
import { userPermissions, users } from "./database/schema.js";

export interface UpstreamIdentity {
  issuer: string;
  subject: string;
  email: string;
  emailVerified: boolean;
  displayName?: string;
  picture?: string;
}

export function createIdentityService(
  db: Database,
  defaultPermission: string,
  bootstrapGrants: BootstrapPermissionGrant[],
) {
  async function permissionsFor(userId: string): Promise<string[]> {
    const rows = await db
      .select({ permission: userPermissions.permission })
      .from(userPermissions)
      .where(eq(userPermissions.userId, userId));
    return rows.map((row) => row.permission).sort();
  }

  async function upsertFromMicrosoft(identity: UpstreamIdentity) {
    const normalizedEmail = identity.email.trim().toLowerCase();
    const [existing] = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.upstreamIssuer, identity.issuer),
          eq(users.upstreamSubject, identity.subject),
        ),
      )
      .limit(1);

    const id = existing?.id ?? crypto.randomUUID();
    const [user] = await db
      .insert(users)
      .values({
        id,
        upstreamIssuer: identity.issuer,
        upstreamSubject: identity.subject,
        email: normalizedEmail,
        emailVerified: identity.emailVerified,
        displayName: identity.displayName,
        picture: identity.picture,
      })
      .onConflictDoUpdate({
        target: [users.upstreamIssuer, users.upstreamSubject],
        set: {
          email: normalizedEmail,
          emailVerified: identity.emailVerified,
          displayName: identity.displayName,
          picture: identity.picture,
          updatedAt: new Date(),
        },
      })
      .returning();

    const bootstrap = bootstrapGrants.find((grant) => grant.email === normalizedEmail);
    const permissions = new Set([defaultPermission, ...(bootstrap?.permissions ?? [])]);
    await db
      .insert(userPermissions)
      .values([...permissions].map((permission) => ({ userId: user!.id, permission })))
      .onConflictDoNothing();
    return user!;
  }

  async function findAccount(userId: string) {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return undefined;
    const permissions = await permissionsFor(user.id);
    return {
      accountId: user.id,
      async claims(_use: string, scope: string) {
        const scopes = new Set(scope.split(" "));
        return {
          sub: user.id,
          ...(scopes.has("profile")
            ? { name: user.displayName, picture: user.picture }
            : {}),
          ...(scopes.has("email")
            ? { email: user.email, email_verified: user.emailVerified }
            : {}),
          ...(scopes.has("permissions") ? { permissions } : {}),
        };
      },
    };
  }

  async function findUsersByIds(ids: string[]) {
    return ids.length ? db.select().from(users).where(inArray(users.id, ids)) : [];
  }

  async function findUser(userId: string) {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    return user;
  }

  return { upsertFromMicrosoft, findAccount, permissionsFor, findUsersByIds, findUser };
}

export type IdentityService = ReturnType<typeof createIdentityService>;
