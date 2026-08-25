import type { Hono } from "hono";
import type { Database } from "../../../src/database/client.js";
import { isLocked } from "../context.js";
import type { AppEnv } from "../middleware.js";

type AdminApp = Hono<{ Bindings: Record<string, string>; Variables: AppEnv["Variables"] & { ip?: string } }>;

export interface RouteDeps {
  db: Database;
}

/** Read-only view of portal-wide switches for the settings surface. */
export function registerSettingsRoutes(app: AdminApp, deps: RouteDeps) {
  app.get("/api/settings/lockout", async (c) => {
    return c.json({ locked: await isLocked(deps.db) });
  });
}
