import { and, eq, isNull, sql } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { Database } from "../../../src/database/client.js";
import { authSessions, authorizationConsents, refreshTokens } from "../../../src/database/schema.js";
import { HttpGuardError, writeAudit } from "../context.js";
import type { AppEnv } from "../middleware.js";

type AdminApp = Hono<{ Bindings: Record<string, string>; Variables: AppEnv["Variables"] & { ip?: string } }>;

export interface RouteDeps {
  db: Database;
  resolveClientIp: (c: Context) => string;
  alert?: { url: string; secret: string };
}

function auditMeta(c: Context<{ Bindings: Record<string, string>; Variables: AppEnv["Variables"] & { ip?: string } }>) {
  return { ip: c.get("ip") ?? null, userAgent: c.req.header("user-agent") ?? null };
}

export function registerSessionRoutes(app: AdminApp, deps: RouteDeps) {
  const { db } = deps;

  app.get("/api/sessions", async (c) => {
    const cursorRaw = new URL(c.req.url).searchParams.get("cursor");
    const cursorTs = cursorRaw ? Number(cursorRaw.split("_")[0]) : undefined;
    const result = await db.execute<Record<string, unknown>>(sql`
      select 'a_' || left(a.id_hash, 12) as id, 'sso' as kind, a.user_id as "userId", u.email,
             a.authenticated_at as "authTime", a.created_at as "createdAt", a.expires_at as "expiresAt",
             a.ip::text as ip, a.user_agent as "userAgent"
      from auth_sessions a join users u on u.id = a.user_id
      where a.expires_at > now()
        and (${cursorTs ?? null}::timestamptz is null or a.created_at < ${cursorTs ? new Date(cursorTs).toISOString() : null}::timestamptz)
      order by a.created_at desc
      limit 51
    `);
    const list = result.rows.slice(0, 50);
    const last = list.at(-1) as { createdAt: string } | undefined;
    return c.json({
      sessions: list,
      nextCursor: result.rows.length > 50 && last ? `${new Date(last.createdAt).getTime()}_x` : null,
    });
  });

  app.post("/api/sessions/:idHash/revoke", async (c) => {
    const admin = c.get("admin");
    const idHash = c.req.param("idHash");
    // Only SSO session hashes are revocable through this route; the prefix
    // keeps identifiers non-reversible beyond 12 characters.
    if (!idHash.startsWith("a_")) throw new HttpGuardError(400, "invalid_request", "Unsupported session handle");
    await db.delete(authSessions).where(sql`'a_' || left(id_hash, 12) = ${idHash}`);
    await writeAudit(db, {
      actorUserId: admin.userId,
      action: "portal.session.revoked",
      targetType: "session",
      targetId: idHash,
      ...auditMeta(c),
    });
    return c.json({ ok: true });
  });

  app.get("/api/tokens", async (c) => {
    const onlyActive = c.req.query("active") !== "false";
    const result = await db.execute<Record<string, unknown>>(sql`
      select t.family_id as "familyId", t.user_id as "userId", u.email, t.client_id as "clientId",
             t.resource, t.scopes, t.created_at as "createdAt", t.expires_at as "expiresAt",
             t.revoked_at as "revokedAt", t.consumed_at as "consumedAt"
      from refresh_tokens t join users u on u.id = t.user_id
      where (${onlyActive} or true) and (t.revoked_at is null and t.consumed_at is null and t.expires_at > now() or ${!onlyActive})
      order by t.created_at desc
      limit 100
    `);
    return c.json({ tokens: result.rows });
  });

  app.post("/api/tokens/family/:familyId/revoke", async (c) => {
    const admin = c.get("admin");
    const familyId = c.req.param("familyId");
    const revoked = await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)))
      .returning({ tokenHash: refreshTokens.tokenHash });
    await writeAudit(db, {
      actorUserId: admin.userId,
      action: "portal.tokens.family_revoked",
      targetType: "token_family",
      targetId: familyId,
      afterState: { revokedCount: revoked.length },
      ...auditMeta(c),
    });
    return c.json({ revoked: revoked.length });
  });

  app.get("/api/consents", async (c) => {
    const result = await db.execute<Record<string, unknown>>(sql`
      select c.user_id as "userId", u.email, c.client_id as "clientId",
             coalesce(cl.metadata->>'name', cl.client_id, c.client_id) as "clientName",
             c.scopes, c.resources, c.updated_at as "updatedAt"
      from authorization_consents c
      join users u on u.id = c.user_id
      left join oidc_clients cl on cl.client_id = c.client_id
      order by c.updated_at desc
      limit 200
    `);
    return c.json({ consents: result.rows });
  });

  app.delete("/api/consents/:userId/:clientId", async (c) => {
    const admin = c.get("admin");
    const userId = c.req.param("userId");
    const clientId = c.req.param("clientId");
    const deleted = await db
      .delete(authorizationConsents)
      .where(and(eq(authorizationConsents.userId, userId), eq(authorizationConsents.clientId, clientId)))
      .returning({ clientId: authorizationConsents.clientId });
    if (!deleted.length) throw new HttpGuardError(404, "not_found", "Consent not found");
    await writeAudit(db, {
      actorUserId: admin.userId,
      action: "portal.consent.revoked",
      targetType: "consent",
      targetId: `${userId}:${clientId}`,
      ...auditMeta(c),
    });
    return c.json({ ok: true });
  });
}
