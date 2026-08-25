import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { Database } from "../../../src/database/client.js";
import { authSessions, localCredentials, refreshTokens, userPermissions, users } from "../../../src/database/schema.js";
import { hashPassword, generateTempPassword } from "../passwords.js";
import {
  HttpGuardError,
  keysetCursor,
  nextKeysetCursor,
  targetIsPrivileged,
  writeAudit,
} from "../context.js";
import { requireStepUp } from "../middleware.js";
import type { AppEnv } from "../middleware.js";
import { sendWebhookAlert } from "../webhook.js";

const PAGE_SIZE = 50;

export interface RouteDeps {
  db: Database;
  resolveClientIp: (c: Context) => string;
  alert?: { url: string; secret: string };
  stepUpSeconds: number;
}

type AdminApp = Hono<{ Bindings: Record<string, string>; Variables: AppEnv["Variables"] & { ip?: string } }>;

function auditContext(
  c: Context<{ Bindings: Record<string, string>; Variables: AppEnv["Variables"] & { ip?: string } }>,
) {
  return {
    ip: (c.get("ip") ?? null) as string | null,
    userAgent: c.req.header("user-agent") ?? null,
  };
}

const auditMeta = auditContext;

export function registerUserRoutes(app: AdminApp, deps: RouteDeps) {
  const { db } = deps;

  app.get("/api/users", async (c) => {
    const query = c.req.query("query")?.trim().toLowerCase();
    const cursor = keysetCursor(new URL(c.req.url).searchParams);
    const conditions = [];
    if (query) {
      conditions.push(
        sql`(lower(${users.email}) like ${`%${query}%`} or lower(coalesce(${users.displayName}, '')) like ${`%${query}%`})`,
      );
    }
    if (cursor) {
      conditions.push(
        sql`(${users.createdAt}, ${users.id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
      );
    }
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        provider: users.provider,
        disabled: users.disabled,
        emailVerified: users.emailVerified,
        createdAt: users.createdAt,
        permissions: sql<string[]>`coalesce((
          select json_agg(p.permission order by p.permission)
          from user_permissions p where p.user_id = ${users.id}
        ), '[]'::json)`,
      })
      .from(users)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(PAGE_SIZE + 1);
    const hasMore = rows.length > PAGE_SIZE;
    const page = rows.slice(0, PAGE_SIZE);
    const last = page.at(-1);
    return c.json({
      users: page.map((row) => ({
        ...row,
        privileged: row.permissions.some((permission) => permission.startsWith("portal.")),
      })),
      nextCursor: hasMore && last ? nextKeysetCursor(last) : null,
    });
  });

  app.get("/api/users/:userId", async (c) => {
    const userId = c.req.param("userId");
    await assertTargetVisible(deps, c.get("admin"), userId);
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        provider: users.provider,
        disabled: users.disabled,
        emailVerified: users.emailVerified,
        tokensValidAfter: users.tokensValidAfter,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        permissions: sql<string[]>`coalesce((
          select json_agg(p.permission order by p.permission)
          from user_permissions p where p.user_id = ${users.id}
        ), '[]'::json)`,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw new HttpGuardError(404, "not_found", "User not found");
    return c.json({
      user: {
        ...user,
        privileged: user.permissions.some((permission) => permission.startsWith("portal.")),
      },
    });
  });

  app.put("/api/users/:userId/permissions", requireStepUp(deps.stepUpSeconds), async (c) => {
    const admin = c.get("admin");
    const userId = c.req.param("userId");
    await assertTargetVisible(deps, admin, userId);
    const body = z.object({ permissions: z.array(z.string()) }).safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) throw new HttpGuardError(400, "invalid_request", "permissions array is required");

    if (userId === admin.userId) {
      throw new HttpGuardError(403, "self_edit", "You cannot change your own permissions");
    }
    // Only holders of portal.admins.manage may touch portal.* grants.
    if (
      !admin.permissions.has("portal.admins.manage") &&
      body.data.permissions.some((permission) => permission.startsWith("portal."))
    ) {
      throw new HttpGuardError(403, "forbidden", "portal.admins.manage is required for portal permissions");
    }

    const managers = await db
      .select({ userId: userPermissions.userId })
      .from(userPermissions)
      .where(eq(userPermissions.permission, "portal.admins.manage"));
    const remainingManagers = managers.filter((row) => row.userId !== userId).length;
    const keepsManage = body.data.permissions.includes("portal.admins.manage");
    if (managers.length >= 1 && remainingManagers === 0 && !keepsManage) {
      throw new HttpGuardError(409, "last_admin", "Refusing to remove the last portal.admins.manage holder");
    }

    const before = managers.length ? undefined : undefined;
    void before;
    const previous = await db
      .select({ permission: userPermissions.permission })
      .from(userPermissions)
      .where(and(eq(userPermissions.userId, userId), sql`${userPermissions.permission} like 'portal.%'`));

    await db.transaction(async (tx) => {
      await tx.delete(userPermissions).where(
        and(eq(userPermissions.userId, userId), sql`${userPermissions.permission} like 'portal.%'`),
      );
      const portalGrants = body.data.permissions.filter((permission) => permission.startsWith("portal."));
      if (portalGrants.length > 0) {
        await tx
          .insert(userPermissions)
          .values(portalGrants.map((permission) => ({ userId, permission })))
          .onConflictDoNothing();
      }
    });

    await writeAudit(db, {
      actorUserId: admin.userId,
      action: "portal.user.permissions.replaced",
      targetType: "user",
      targetId: userId,
      beforeState: { portalPermissions: previous.map((row) => row.permission) },
      afterState: { portalPermissions: body.data.permissions.filter((permission) => permission.startsWith("portal.")) },
      ...auditContext(c),
    });
    if (deps.alert) {
      sendWebhookAlert(deps.alert.url, deps.alert.secret, {
        event: "portal.user.permissions.replaced",
        actor: admin.userId,
        targetType: "user",
        targetId: userId,
        detail: { permissions: body.data.permissions },
      });
    }
    return c.json({ ok: true });
  });

  app.post("/api/users/:userId/disable", requireStepUp(deps.stepUpSeconds), async (c) => {
    const admin = c.get("admin");
    const userId = c.req.param("userId");
    if (userId === admin.userId) throw new HttpGuardError(403, "self_edit", "You cannot disable your own account");
    await assertTargetVisible(deps, admin, userId);
    await setUserActive(db, userId, false);
    await writeAudit(db, {
      actorUserId: admin.userId,
      action: "portal.user.disabled",
      targetType: "user",
      targetId: userId,
      ...auditContext(c),
    });
    return c.json({ ok: true });
  });

  app.post("/api/users/:userId/enable", requireStepUp(deps.stepUpSeconds), async (c) => {
    const admin = c.get("admin");
    const userId = c.req.param("userId");
    await assertTargetVisible(deps, admin, userId);
    await setUserActive(db, userId, true);
    await writeAudit(db, {
      actorUserId: admin.userId,
      action: "portal.user.enabled",
      targetType: "user",
      targetId: userId,
      ...auditContext(c),
    });
    return c.json({ ok: true });
  });

  app.post("/api/users/local", async (c) => {
    const admin = c.get("admin");
    const body = z
      .object({
        email: z.string().email(),
        displayName: z.string().min(1).max(200),
        permissions: z.array(z.string()).default([]),
      })
      .safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) throw new HttpGuardError(400, "invalid_request", "Email and displayName are required");
    const email = body.data.email.trim().toLowerCase();
    // Plaintext is returned exactly once; the account holder must reset it.
    const tempPassword = generateTempPassword();
    const userId = crypto.randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(users).values({
        id: userId,
        provider: "local",
        upstreamIssuer: "local",
        upstreamSubject: userId,
        email,
        emailVerified: false,
        displayName: body.data.displayName,
      });
      await tx.insert(localCredentials).values({
        userId,
        passwordHash: await hashPassword(tempPassword),
        passwordUpdatedAt: new Date(),
        mustResetPassword: true,
      });
      if (body.data.permissions.length > 0) {
        await tx
          .insert(userPermissions)
          .values(body.data.permissions.map((permission) => ({ userId, permission })))
          .onConflictDoNothing();
      }
    });
    await writeAudit(db, {
      actorUserId: admin.userId,
      action: "portal.user.local_created",
      targetType: "user",
      targetId: userId,
      afterState: { email, permissions: body.data.permissions },
      ...auditMeta(c),
    });
    return c.json({ userId, tempPassword });
  });

  app.post("/api/users/:userId/credentials/reset", requireStepUp(deps.stepUpSeconds), async (c) => {
    const admin = c.get("admin");
    const userId = c.req.param("userId");
    await assertTargetVisible(deps, admin, userId);
    const tempPassword = generateTempPassword();
    const updated = await db
      .update(localCredentials)
      .set({
        passwordHash: await hashPassword(tempPassword),
        passwordUpdatedAt: new Date(),
        mustResetPassword: true,
        failedAttempts: 0,
        lockedUntil: null,
        totpConfirmedAt: null,
        totpSecretEnc: null,
        recoveryCodes: [],
      })
      .where(eq(localCredentials.userId, userId))
      .returning({ userId: localCredentials.userId });
    if (!updated.length) throw new HttpGuardError(404, "not_found", "This account has no local credentials");
    // A credential reset also kills every existing SSO session.
    await db.delete(authSessions).where(eq(authSessions.userId, userId));
    await writeAudit(db, {
      actorUserId: admin.userId,
      action: "portal.user.credentials_reset",
      targetType: "user",
      targetId: userId,
      ...auditMeta(c),
    });
    return c.json({ tempPassword });
  });

  app.delete("/api/users/:userId", requireStepUp(deps.stepUpSeconds), async (c) => {
    const admin = c.get("admin");
    const userId = c.req.param("userId");
    if (userId === admin.userId) throw new HttpGuardError(403, "self_edit", "You cannot delete your own account");
    await assertTargetVisible(deps, admin, userId);
    // FK cascades remove sessions, credentials, permissions, consents, and
    // token families; audit rows keep their actor via ON DELETE SET NULL.
    const deleted = await db
      .delete(users)
      .where(eq(users.id, userId))
      .returning({ id: users.id });
    if (!deleted.length) throw new HttpGuardError(404, "not_found", "User not found");
    await writeAudit(db, {
      actorUserId: admin.userId,
      action: "portal.user.deleted",
      targetType: "user",
      targetId: userId,
      ...auditContext(c),
    });
    return c.json({ ok: true });
  });

  app.post("/api/users/:userId/force-signout", requireStepUp(deps.stepUpSeconds), async (c) => {
    const admin = c.get("admin");
    const userId = c.req.param("userId");
    await assertTargetVisible(deps, admin, userId);
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.delete(authSessions).where(eq(authSessions.userId, userId));
      await tx
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
      await tx.update(users).set({ tokensValidAfter: now, updatedAt: now }).where(eq(users.id, userId));
    });
    await writeAudit(db, {
      actorUserId: admin.userId,
      action: "portal.user.force_signout",
      targetType: "user",
      targetId: userId,
      ...auditContext(c),
    });
    return c.json({ ok: true });
  });
}

async function setUserActive(db: Database, userId: string, active: boolean) {
  const now = new Date();
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(users)
      .set({
        disabled: !active,
        updatedAt: now,
        ...(active ? {} : { tokensValidAfter: now }),
      })
      .where(and(eq(users.id, userId), eq(users.disabled, active)))
      .returning({ id: users.id });
    if (!updated.length || active) return;
    await tx.delete(authSessions).where(eq(authSessions.userId, userId));
    await tx
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  });
}

/** Shield rule: portal-permission holders need portal.privileged.read to view or act. */
export async function assertTargetVisible(
  deps: Pick<RouteDeps, "db">,
  actor: { permissions: ReadonlySet<string> },
  targetUserId: string,
) {
  if (actor.permissions.has("portal.privileged.read")) return;
  if (await targetIsPrivileged(deps.db, targetUserId)) {
    throw new HttpGuardError(
      403,
      "privileged_target",
      "This account is shielded; portal.privileged.read is required",
    );
  }
}



