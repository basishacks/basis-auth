import type { Hono } from "hono";
import { sql } from "drizzle-orm";
import type { Database } from "../../../src/database/client.js";
import type { AppEnv } from "../middleware.js";

type AdminApp = Hono<{ Bindings: Record<string, string>; Variables: AppEnv["Variables"] & { ip?: string } }>;

export interface RouteDeps {
  db: Database;
}

const PAGE_SIZE = 50;

/**
 * Audit and sign-in log browsers. Both use keyset pagination on
 * (created_at, id) so pages stay O(log n) regardless of table growth.
 */
export function registerLogRoutes(app: AdminApp, deps: RouteDeps) {
  const { db } = deps;

  app.get("/api/audit", async (c) => {
    const url = new URL(c.req.url);
    const action = url.searchParams.get("action")?.trim();
    const target = url.searchParams.get("target")?.trim();
    const cursorRaw = url.searchParams.get("cursor");
    const cursorTs = cursorRaw && Number.isFinite(Number(cursorRaw.split("_")[0]))
      ? new Date(Number(cursorRaw.split("_")[0])).toISOString()
      : null;
    // Optional text filters carry explicit ::text casts: bare null params in
    // OR clauses leave Postgres unable to deduce parameter types.
    const result = await db.execute<Record<string, unknown>>(sql`
      select e.id, e.actor_user_id as "actorUserId", a.email as "actorEmail",
             e.action, e.target_type as "targetType", e.target_id as "targetId",
             e.before_state as "beforeState", e.after_state as "afterState",
             e.ip::text as ip, e.user_agent as "userAgent", e.created_at as "createdAt"
      from audit_events e
      left join users a on a.id = e.actor_user_id
      where (${cursorTs}::timestamptz is null or e.created_at < ${cursorTs}::timestamptz)
        and (${action ?? null}::text is null or e.action like ${action ? `%${action}%` : null}::text)
        and (${target ?? null}::text is null or e.target_id like ${target ? `%${target}%` : null}::text)
      order by e.created_at desc
      limit ${PAGE_SIZE + 1}
    `);
    const list = result.rows.slice(0, PAGE_SIZE);
    const last = list.at(-1) as { createdAt: string } | undefined;
    return c.json({
      events: list,
      nextCursor: result.rows.length > PAGE_SIZE && last ? `${new Date(last.createdAt).getTime()}_x` : null,
    });
  });

  app.get("/api/signins", async (c) => {
    const url = new URL(c.req.url);
    const kind = url.searchParams.get("kind")?.trim();
    const clientId = url.searchParams.get("clientId")?.trim();
    const successOnly = url.searchParams.get("success");
    const successParam = successOnly === null || successOnly === "" ? null : successOnly === "true";
    const result = await db.execute<Record<string, unknown>>(sql`
      select ev.id, ev.user_id as "userId", u.email, ev.kind, ev.provider,
             ev.client_id as "clientId", ev.success, ev.ip::text as ip,
             ev.user_agent as "userAgent", ev.detail, ev.created_at as "createdAt"
      from auth_events ev
      left join users u on u.id = ev.user_id
      where (${kind ?? null}::text is null or ev.kind = ${kind ?? null}::text)
        and (${clientId ?? null}::text is null or ev.client_id = ${clientId ?? null}::text)
        and (${successParam}::boolean is null or ev.success = (${successParam})::boolean)
      order by ev.created_at desc
      limit ${PAGE_SIZE + 1}
    `);
    const list = result.rows.slice(0, PAGE_SIZE);
    const last = list.at(-1) as { id: number } | undefined;
    return c.json({
      events: list,
      nextCursor: result.rows.length > PAGE_SIZE && last ? String(last.id) : null,
    });
  });
}
