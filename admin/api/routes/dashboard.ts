import type { Hono } from "hono";
import { sql } from "drizzle-orm";
import type { Database } from "../../../src/database/client.js";
import type { AppEnv } from "../middleware.js";

type AdminApp = Hono<{ Bindings: Record<string, string>; Variables: AppEnv["Variables"] & { ip?: string } }>;

export interface RouteDeps {
  db: Database;
}

/**
 * Dashboard summary. Every counter is computed in ONE statement using
 * filtered aggregates over the partial indexes, so latency equals the
 * slowest sub-count rather than the sum of sequential queries.
 */
export function registerDashboardRoutes(app: AdminApp, deps: RouteDeps) {
  const { db } = deps;

  app.get("/api/dashboard/summary", async (c) => {
    const counters = await db.execute<Record<string, number>>(sql`
      select
        (select count(*) from auth_sessions where expires_at > now())::int as "activeSessions",
        (select count(*) from refresh_tokens where revoked_at is null and consumed_at is null and expires_at > now())::int as "liveTokens",
        (select count(*) from users where disabled = false)::int as "activeUsers",
        (select count(*) from oidc_clients)::int as "registeredClients",
        (select count(*) from auth_events where kind = 'sign_in' and success and created_at > now() - interval '24 hours')::int as "signIns24h",
        (select count(*) from auth_events where kind = 'sign_in' and success and created_at > now() - interval '7 days')::int as "signIns7d",
        (select count(*) from auth_events where success = false and created_at > now() - interval '24 hours')::int as "failures24h",
        (select count(*) from auth_events where kind = 'token_refresh_rejected' and created_at > now() - interval '7 days')::int as "reuseDetections7d",
        (select count(*) from local_credentials where locked_until is not null and locked_until > now())::int as "lockedAccounts",
        (select count(*) from client_secrets where revoked_at is null and expires_at is not null and expires_at between now() and now() + interval '14 days')::int as "expiringSecrets"
    `);
    const recentAudit = await db.execute<Record<string, unknown>>(sql`
      select e.id, e.action, e.target_type as "targetType", e.target_id as "targetId",
             u.email as "actorEmail", e.created_at as "createdAt"
      from audit_events e left join users u on u.id = e.actor_user_id
      order by e.created_at desc limit 10
    `);
    const recentSignIns = await db.execute<Record<string, unknown>>(sql`
      select ev.kind, ev.success, ev.provider, ev.client_id as "clientId",
             u.email, ev.ip::text as ip, ev.created_at as "createdAt"
      from auth_events ev left join users u on u.id = ev.user_id
      order by ev.created_at desc limit 10
    `);
    const hygiene = await db.execute<Record<string, unknown>>(sql`
      select c.client_id as "clientId", c.metadata->>'name' as name,
             max(s.last_used_at) as "lastUsedAt",
             min(s.expires_at) filter (where s.revoked_at is null) as "nextExpiry"
      from oidc_clients c left join client_secrets s on s.client_id = c.client_id
      group by c.client_id, c.metadata
      having max(s.last_used_at) is null or max(s.last_used_at) < now() - interval '90 days'
         or bool_or(s.revoked_at is not null)
      order by 2 nulls last
      limit 10
    `);
    return c.json({
      counters: counters.rows[0] ?? {},
      recentAudit: recentAudit.rows,
      recentSignIns: recentSignIns.rows,
      hygieneAlerts: hygiene.rows,
    });
  });
}
