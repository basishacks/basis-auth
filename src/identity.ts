import { eq, inArray, sql } from "drizzle-orm";
import type { BootstrapPermissionGrant } from "./config.js";
import type { Database } from "./database/client.js";
import { userPermissions, users } from "./database/schema.js";

export interface UpstreamIdentity {
  provider: string;
  issuer: string;
  subject: string;
  email: string;
  emailVerified: boolean;
  displayName?: string;
  picture?: { data: Buffer; contentType: string };
}

export interface UserAccount {
  id: string;
  provider: string;
  email: string;
  emailVerified: boolean;
  disabled: boolean;
  displayName: string | null;
  tokensValidAfter: Date | null;
  createdAt: Date;
  updatedAt: Date;
  hasPicture: boolean;
}

/**
 * Core auth-relevant columns plus permissions fetched in a single indexed
 * round trip. Hot paths (token verification, authorization, token issuance)
 * use this instead of loading profile data or picture blobs they never read.
 */
export interface UserCore {
  id: string;
  email: string;
  disabled: boolean;
  tokensValidAfter: Date | null;
  permissions: string[];
}

const userCoreSelection = {
  id: users.id,
  email: users.email,
  disabled: users.disabled,
  tokensValidAfter: users.tokensValidAfter,
  permissions: sql<string[]>`coalesce((
    select json_agg(p.permission order by p.permission)
    from user_permissions p
    where p.user_id = ${users.id}
  ), '[]'::json)`,
};

export function createIdentityService(
  db: Database,
  defaultPermission: string,
  bootstrapGrants: BootstrapPermissionGrant[],
) {
  async function findUserCore(userId: string): Promise<UserCore | undefined> {
    const [row] = await db
      .select(userCoreSelection)
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row;
  }

  async function permissionsFor(userId: string): Promise<string[]> {
    const core = await findUserCore(userId);
    return core ? core.permissions : [];
  }

  async function upsertFromMicrosoft(identity: UpstreamIdentity) {
    const normalizedEmail = identity.email.trim().toLowerCase();

    // Claim pending accounts provisioned for this email (e.g. by
    // admin:grant) before their first real sign-in. Adoption is limited to
    // accounts whose email was never verified, so a verified Microsoft or
    // local account can never be hijacked by an email collision.
    const [claimable] = await db
      .select({ id: users.id, emailVerified: users.emailVerified })
      .from(users)
      .where(sql`lower(${users.email}) = ${normalizedEmail}`)
      .limit(1);

    if (claimable && !claimable.emailVerified) {
      const [adopted] = await db
        .update(users)
        .set({
          provider: identity.provider,
          upstreamIssuer: identity.issuer,
          upstreamSubject: identity.subject,
          email: normalizedEmail,
          emailVerified: identity.emailVerified,
          displayName: identity.displayName,
          picture: identity.picture?.data,
          pictureContentType: identity.picture?.contentType,
          updatedAt: new Date(),
        })
        .where(eq(users.id, claimable.id))
        .returning({ id: users.id });
    if (!adopted) throw new Error("Pending account adoption failed");
      return (await findUser(adopted.id))!;
    }

    // Single-statement upsert; (xmax = 0) is true only for freshly inserted rows.
    const [user] = await db
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        provider: identity.provider,
        upstreamIssuer: identity.issuer,
        upstreamSubject: identity.subject,
        email: normalizedEmail,
        emailVerified: identity.emailVerified,
        displayName: identity.displayName,
        picture: identity.picture?.data,
        pictureContentType: identity.picture?.contentType,
      })
      .onConflictDoUpdate({
        target: [users.provider, users.upstreamIssuer, users.upstreamSubject],
        set: {
          email: normalizedEmail,
          emailVerified: identity.emailVerified,
          displayName: identity.displayName,
          picture: identity.picture?.data,
          pictureContentType: identity.picture?.contentType,
          updatedAt: new Date(),
        },
      })
      .returning({ id: users.id, inserted: sql<boolean>`(xmax = 0)` });

    if (!user) throw new Error("Upsert did not return the account row");

    // Bootstrap grants apply exactly once, when the account row is created,
    // so permissions removed later by an administrator stay removed.
    if (!user.inserted) return (await findUser(user.id))!;

    const bootstrap = bootstrapGrants.find((grant) => grant.email === normalizedEmail);
    const permissions = new Set([defaultPermission, ...(bootstrap?.permissions ?? [])]);
    await db
      .insert(userPermissions)
      .values([...permissions].map((permission) => ({ userId: user.id, permission })))
      .onConflictDoNothing();
    return (await findUser(user.id))!;
  }

  async function fetchProfilePicture(
    userId: string,
  ): Promise<{ data: Buffer; contentType: string } | undefined> {
    const [picture] = await db
      .select({ data: users.picture, contentType: users.pictureContentType })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!picture?.data || !picture.contentType) return undefined;
    return { data: picture.data, contentType: picture.contentType };
  }

  async function findUser(userId: string): Promise<UserAccount | undefined> {
    const [user] = await db
      .select({
        id: users.id,
        provider: users.provider,
        email: users.email,
        emailVerified: users.emailVerified,
        disabled: users.disabled,
        displayName: users.displayName,
        tokensValidAfter: users.tokensValidAfter,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        hasPicture: sql<boolean>`${users.picture} is not null`,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return user;
  }

  async function findAccount(userId: string) {
    const [account] = await db
      .select({
        ...userCoreSelection,
        displayName: users.displayName,
        emailVerified: users.emailVerified,
        hasPicture: sql<boolean>`${users.picture} is not null`,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!account || account.disabled) return undefined;

    let pictureDataUri: string | undefined;
    let pictureLoaded = false;

    return {
      accountId: account.id,
      async claims(_use: string, scope: string) {
        const scopes = new Set(scope.split(" "));
        // The picture blob loads lazily, only when a caller actually asks for
        // the profile claim, instead of on every token verification.
        let picture: string | undefined;
        if (scopes.has("profile")) {
          if (!pictureLoaded && account.hasPicture) {
            const stored = await fetchProfilePicture(account.id);
            pictureDataUri = stored
              ? `data:${stored.contentType};base64,${stored.data.toString("base64")}`
              : undefined;
          }
          pictureLoaded = true;
          picture = pictureDataUri;
        }
        return {
          sub: account.id,
          ...(scopes.has("profile") ? { name: account.displayName, picture } : {}),
          ...(scopes.has("email")
            ? { email: account.email, email_verified: account.emailVerified }
            : {}),
          ...(scopes.has("permissions") ? { permissions: account.permissions } : {}),
        };
      },
    };
  }

  async function findUsersByIds(ids: string[]) {
    return ids.length ? db.select().from(users).where(inArray(users.id, ids)) : [];
  }

  return {
    upsertFromMicrosoft,
    findAccount,
    findUserCore,
    findUser,
    fetchProfilePicture,
    permissionsFor,
    findUsersByIds,
  };
}

export type IdentityService = ReturnType<typeof createIdentityService>;
