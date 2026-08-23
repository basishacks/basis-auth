import { and, asc, eq, isNull } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { Database } from "../../../src/database/client.js";
import { hashSecret } from "../../../src/database/seed.js";
import { invalidateClient } from "../../../src/oauth/service.js";
import { appAssets, clientSecrets, oidcClients } from "../../../src/database/schema.js";
import { HttpGuardError, writeAudit } from "../context.js";
import type { AppEnv } from "../middleware.js";

type AdminApp = Hono<{ Bindings: Record<string, string>; Variables: AppEnv["Variables"] & { ip?: string } }>;

export interface RouteDeps {
  db: Database;
  resolveClientIp: (c: Context) => string;
  alert?: { url: string; secret: string };
}

const MAX_LOGO_BYTES = 512 * 1024;
const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

const clientInputSchema = z.object({
  name: z.string().min(1).max(100),
  redirectUris: z.array(z.url()).min(1),
  public: z.boolean(),
  scopes: z.array(z.string().min(1)).default([]),
  resources: z.array(z.string().min(1)).min(1),
  requireConsent: z.boolean().default(true),
  filterMode: z.enum(["whitelist", "blacklist"]).nullable().default(null),
  filterContent: z.array(z.string()).default([]),
});

function generateClientSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `sk-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function auditMeta(c: Context<{ Bindings: Record<string, string>; Variables: AppEnv["Variables"] & { ip?: string } }>) {
  return { ip: c.get("ip") ?? null, userAgent: c.req.header("user-agent") ?? null };
}

async function insertClientSecret(db: Database, clientId: string, name: string, expiresInDays?: number) {
  const secret = generateClientSecret();
  const now = new Date();
  await db.insert(clientSecrets).values({
    id: crypto.randomUUID(),
    clientId,
    name,
    secretHash: await hashSecret(secret),
    expiresAt: expiresInDays ? new Date(now.getTime() + expiresInDays * 86_400_000) : null,
  });
  return secret;
}

export function registerClientRoutes(app: AdminApp, deps: RouteDeps) {
  const { db } = deps;

  app.get("/api/clients", async (c) => {
    const rows = await db.select().from(oidcClients).orderBy(asc(oidcClients.clientId));
    return c.json({ clients: rows });
  });

  app.post("/api/clients", async (c) => {
    const admin = c.get("admin");
    const parsed = clientInputSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) throw new HttpGuardError(400, "invalid_request", "Invalid application input");
    const clientId = crypto.randomUUID();
    const data = parsed.data;
    await db.insert(oidcClients).values({
      clientId,
      metadata: {
        name: data.name,
        redirectUris: data.redirectUris,
        public: data.public,
        scopes: data.scopes,
      },
      secretHash: null,
      resources: data.resources,
      requireConsent: data.requireConsent,
      filterMode: data.filterMode,
      filterContent: data.filterContent.map((value) => value.trim().toLowerCase()),
    });
    let secret: string | undefined;
    if (!data.public) {
      secret = await insertClientSecret(db, clientId, "Initial secret");
    }
    invalidateClient(clientId);
    await writeAudit(db, {
      actorUserId: admin.userId,
      action: "portal.client.created",
      targetType: "client",
      targetId: clientId,
      afterState: { name: data.name, public: data.public },
      ...auditMeta(c),
    });
    return c.json({ clientId, secret });
  });

  app.patch("/api/clients/:clientId", async (c) => {
    const admin = c.get("admin");
    const clientId = c.req.param("clientId");
    const [before] = await db.select().from(oidcClients).where(eq(oidcClients.clientId, clientId)).limit(1);
    if (!before) throw new HttpGuardError(404, "not_found", "Application not found");
    const parsed = clientInputSchema.partial().safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) throw new HttpGuardError(400, "invalid_request", "Invalid application input");
    const data = parsed.data;

    const metadata: Record<string, unknown> = { ...(before.metadata as Record<string, unknown>) };
    if (data.name !== undefined || data.redirectUris !== undefined || data.public !== undefined || data.scopes !== undefined) {
      metadata.name = data.name ?? (metadata.name as string);
      metadata.redirectUris = data.redirectUris ?? metadata.redirectUris;
      metadata.public = data.public ?? metadata.public;
      metadata.scopes = data.scopes ?? metadata.scopes;
    }
    await db
      .update(oidcClients)
      .set({
        metadata,
        resources: data.resources ?? before.resources,
        requireConsent: data.requireConsent ?? before.requireConsent,
        filterMode: data.filterMode ?? before.filterMode,
        filterContent:
          data.filterContent?.map((value) => value.trim().toLowerCase()) ?? before.filterContent,
        updatedAt: new Date(),
      })
      .where(eq(oidcClients.clientId, clientId));
    invalidateClient(clientId);
    await writeAudit(db, {
      actorUserId: admin.userId,
      action: "portal.client.updated",
      targetType: "client",
      targetId: clientId,
      beforeState: before,
      ...auditMeta(c),
    });
    return c.json({ ok: true });
  });

  app.delete("/api/clients/:clientId", async (c) => {
    const admin = c.get("admin");
    const clientId = c.req.param("clientId");
    const deleted = await db
      .delete(oidcClients)
      .where(eq(oidcClients.clientId, clientId))
      .returning({ clientId: oidcClients.clientId });
    if (!deleted.length) throw new HttpGuardError(404, "not_found", "Application not found");
    invalidateClient(clientId);
    await writeAudit(db, {
      actorUserId: admin.userId,
      action: "portal.client.deleted",
      targetType: "client",
      targetId: clientId,
      ...auditMeta(c),
    });
    return c.json({ ok: true });
  });

  app.get("/api/clients/:clientId/secrets", async (c) => {
    const clientId = c.req.param("clientId");
    const rows = await db
      .select({
        id: clientSecrets.id,
        name: clientSecrets.name,
        createdAt: clientSecrets.createdAt,
        expiresAt: clientSecrets.expiresAt,
        lastUsedAt: clientSecrets.lastUsedAt,
        revokedAt: clientSecrets.revokedAt,
      })
      .from(clientSecrets)
      .where(eq(clientSecrets.clientId, clientId))
      .orderBy(asc(clientSecrets.createdAt));
    return c.json({ secrets: rows });
  });

  app.post("/api/clients/:clientId/secrets", async (c) => {
    const admin = c.get("admin");
    const clientId = c.req.param("clientId");
    const body = z
      .object({ name: z.string().min(1).max(100), expiresInDays: z.number().int().positive().optional() })
      .safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) throw new HttpGuardError(400, "invalid_request", "A secret name is required");
    const [exists] = await db
      .select({ clientId: oidcClients.clientId })
      .from(oidcClients)
      .where(eq(oidcClients.clientId, clientId))
      .limit(1);
    if (!exists) throw new HttpGuardError(404, "not_found", "Application not found");
    // Plaintext is returned exactly once and never persisted.
    const secret = await insertClientSecret(db, clientId, body.data.name, body.data.expiresInDays);
    await writeAudit(db, {
      actorUserId: admin.userId,
      action: "portal.client.secret.created",
      targetType: "client",
      targetId: clientId,
      ...auditMeta(c),
    });
    return c.json({ secret });
  });

  app.delete("/api/clients/:clientId/secrets/:secretId", async (c) => {
    const admin = c.get("admin");
    const clientId = c.req.param("clientId");
    const secretId = c.req.param("secretId");
    const revoked = await db
      .update(clientSecrets)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(clientSecrets.id, secretId),
          eq(clientSecrets.clientId, clientId),
          isNull(clientSecrets.revokedAt),
        ),
      )
      .returning({ id: clientSecrets.id });
    if (!revoked.length) throw new HttpGuardError(404, "not_found", "Secret not found or already revoked");
    await writeAudit(db, {
      actorUserId: admin.userId,
      action: "portal.client.secret.revoked",
      targetType: "client",
      targetId: clientId,
      afterState: { secretId },
      ...auditMeta(c),
    });
    return c.json({ ok: true });
  });

  app.put("/api/clients/:clientId/logo", async (c) => {
    const admin = c.get("admin");
    const clientId = c.req.param("clientId");
    const body = z
      .object({ data: z.string(), contentType: z.string() })
      .safeParse(await c.req.json().catch(() => undefined));
    if (!body.success || !ALLOWED_LOGO_TYPES.includes(body.data.contentType)) {
      throw new HttpGuardError(400, "invalid_request", "Logo must be png, jpeg, webp, or svg");
    }
    const logoData = body.success ? body.data : undefined;
    const bytes = Buffer.from(logoData!.data, "base64");
    if (bytes.length > MAX_LOGO_BYTES) {
      throw new HttpGuardError(413, "too_large", "Logo must be 512 KB or smaller");
    }
    await db
      .insert(appAssets)
      .values({ clientId, kind: "logo", bytes, contentType: body.data.contentType })
      .onConflictDoUpdate({
        target: [appAssets.clientId, appAssets.kind],
        set: { bytes, contentType: body.data.contentType, updatedAt: new Date() },
      });
    await writeAudit(db, {
      actorUserId: admin.userId,
      action: "portal.client.logo.updated",
      targetType: "client",
      targetId: clientId,
      ...auditMeta(c),
    });
    return c.json({ ok: true });
  });

  app.get("/api/clients/:clientId/logo", async (c) => {
    const clientId = c.req.param("clientId");
    const [asset] = await db
      .select({ bytes: appAssets.bytes, contentType: appAssets.contentType })
      .from(appAssets)
      .where(and(eq(appAssets.clientId, clientId), eq(appAssets.kind, "logo")))
      .limit(1);
    if (!asset) return c.json({ error: "not_found" }, 404);
    c.header("Cache-Control", "public, max-age=300");
    c.header("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'");
    c.header("Content-Disposition", 'attachment; filename="logo"');
    c.header("X-Content-Type-Options", "nosniff");
    return c.body(new Uint8Array(asset.bytes));
  });
}
