import { eq, sql } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { Database } from "../../../src/database/client.js";
import { resourceServers } from "../../../src/database/schema.js";
import { HttpGuardError, writeAudit, type AppEnv } from "../context.js";

type AdminApp = Hono<{ Bindings: Record<string, string>; Variables: AppEnv["Variables"] & { ip?: string } }>;
type AdminContext = Context<{ Bindings: Record<string, string>; Variables: AppEnv["Variables"] & { ip?: string } }>;

export interface RouteDeps {
  db: Database;
}

const resourceSchema = z.object({
  scopes: z.array(z.string().min(1)).default([]),
});

function meta(c: AdminContext) {
  return { ip: c.get("ip") ?? null, userAgent: c.req.header("user-agent") ?? null };
}

export function registerResourceRoutes(app: AdminApp, deps: RouteDeps) {
  const { db } = deps;

  app.get("/api/resources", async (c) => {
    const rows = await db.select().from(resourceServers).orderBy(resourceServers.audience);
    return c.json({ resources: rows });
  });

  app.put("/api/resources/:audience", async (c) => {
    const admin = c.get("admin");
    const audience = decodeURIComponent(c.req.param("audience"));
    const parsed = resourceSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) throw new HttpGuardError(400, "invalid_request", "Invalid resource input");
    await db
      .insert(resourceServers)
      .values({ audience, scopes: parsed.data.scopes })
      .onConflictDoUpdate({
        target: resourceServers.audience,
        set: { scopes: parsed.data.scopes, updatedAt: new Date() },
      });
    await writeAudit(db, {
      actorUserId: admin.userId,
      action: "portal.resource.saved",
      targetType: "resource",
      targetId: audience,
      afterState: { scopes: parsed.data.scopes },
      ...meta(c),
    });
    return c.json({ ok: true });
  });

  app.delete("/api/resources/:audience", async (c) => {
    const admin = c.get("admin");
    const audience = decodeURIComponent(c.req.param("audience"));
    // Refuse deletion while any client still references the resource.
    const dependent = await db.execute<{ client_id: string }>(sql`
      select client_id from oidc_clients where resources @> ${JSON.stringify([audience])}::jsonb limit 1
    `);
    if (dependent.rows[0]) {
      throw new HttpGuardError(409, "resource_in_use", `Client ${dependent.rows[0].client_id} still references this resource`);
    }
    await db.delete(resourceServers).where(eq(resourceServers.audience, audience));
    await writeAudit(db, {
      actorUserId: admin.userId,
      action: "portal.resource.deleted",
      targetType: "resource",
      targetId: audience,
      ...meta(c),
    });
    return c.json({ ok: true });
  });
}
