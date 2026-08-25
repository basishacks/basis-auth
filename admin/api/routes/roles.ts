import { sql } from "drizzle-orm";
import type { Hono } from "hono";
import type { Database } from "../../../src/database/client.js";
import type { AppEnv } from "../middleware.js";

type AdminApp = Hono<{ Bindings: Record<string, string>; Variables: AppEnv["Variables"] & { ip?: string } }>;

export interface RouteDeps {
  db: Database;
}

/** Directory of every account holding portal permissions, grouped client-side. */
export function registerRolesRoutes(app: AdminApp, deps: RouteDeps) {
  app.get("/api/roles/admins", async (c) => {
    const result = await deps.db.execute<Record<string, unknown>>(sql`
      select u.id as "userId", u.email, u.display_name as "displayName",
             u.disabled, p.permission
      from user_permissions p
      join users u on u.id = p.user_id
      where p.permission like 'portal.%'
      order by p.permission, u.email
    `);
    const assignments = result.rows.map((row: any) => ({
      userId: row.userId,
      email: row.email,
      displayName: row.displayName,
      disabled: row.disabled,
      permission: row.permission,
    }));
    return c.json({ assignments });
  });
}
