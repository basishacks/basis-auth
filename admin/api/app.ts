import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { Database } from "../../src/database/client.js";
import { createClientIpResolver } from "../../src/security/ip.js";
import type { AdminConfig } from "../config.js";
import { createAdminAuthService, BRIDGE_MAX_AGE_SECONDS } from "./auth.js";
import {
  csrfTokenFor,
  HttpGuardError,
  setLocked,
  writeAudit,
} from "./context.js";
import {
  createIpAllowlistMiddleware,
  createLockoutMiddleware,
  requireCsrf,
  requirePermissions,
  requireSession,
  requireStepUp,
  type AppEnv,
} from "./middleware.js";
import { sendWebhookAlert } from "./webhook.js";
import { registerUserRoutes } from "./routes/users.js";
import { registerClientRoutes } from "./routes/clients.js";
import { registerResourceRoutes } from "./routes/resources.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerLogRoutes } from "./routes/logs.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";

const SESSION_COOKIE = "basis_admin_session";
const BRIDGE_COOKIE = "basis_admin_bridge";

export function createAdminApp(config: AdminConfig, db: Database) {
  const app = new Hono<{ Bindings: Record<string, string>; Variables: AppEnv["Variables"] }>();
  const secureCookies = config.environment === "production";
  const sessionCookieName = secureCookies ? `__Host-${SESSION_COOKIE}` : SESSION_COOKIE;
  const bridgeCookieName = secureCookies ? `__Host-${BRIDGE_COOKIE}` : BRIDGE_COOKIE;
  const cookieOptions = {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "Lax" as const,
    path: "/",
  };
  const resolveClientIp = createClientIpResolver(config.trustProxy);
  const auth = createAdminAuthService(config, db);
  const cookieSecret = config.cookieKeys[0]!;

  app.use("*", secureHeaders());

  // The health probe stays reachable even while locked or IP-blocked so the
  // process manager can keep supervising the service.
  app.get("/healthz", (c) => c.json({ status: "ok" }));

  app.use("*", createIpAllowlistMiddleware(config.ipAllowlist, resolveClientIp));
  app.use("/api/*", createLockoutMiddleware(db));

  const routeDeps = {
    db,
    resolveClientIp,
    alert: config.alertWebhook,
  };
  registerUserRoutes(app, routeDeps);
  registerClientRoutes(app, routeDeps);
  registerResourceRoutes(app, routeDeps);
  registerSessionRoutes(app, routeDeps);
  registerLogRoutes(app, routeDeps);
  registerDashboardRoutes(app, routeDeps);

  app.get("/auth/start", async (c) => {
    try {
      const login = await auth.startLogin();
      setCookie(c, bridgeCookieName, login.bridge, {
        ...cookieOptions,
        maxAge: BRIDGE_MAX_AGE_SECONDS,
        path: "/auth/callback",
      });
      return c.json({ redirectTo: login.redirectTo });
    } catch (error) {
      console.error("Portal login start failed", error);
      const cause = (error as { cause?: { code?: string } })?.cause?.code ?? "";
      const description =
        cause === "ECONNREFUSED"
          ? "The identity provider is not reachable. Start it with: npm run dev:auth"
          : "The identity provider is unreachable";
      throw new HttpGuardError(502, "upstream_error", description);
    }
  });

  app.get("/auth/callback", async (c) => {
    const callbackUrl = new URL(c.req.url);
    try {
      const result = await auth.handleCallback({
        callbackUrl,
        bridge: getCookie(c, bridgeCookieName),
        existingRawToken: getCookie(c, sessionCookieName),
        ip: resolveClientIp(c),
        userAgent: c.req.header("user-agent") ?? null,
      });
      deleteCookie(c, bridgeCookieName, { path: "/auth/callback" });
      setCookie(c, sessionCookieName, result.sessionToken, {
        ...cookieOptions,
        maxAge: config.sessionTtlHours * 3600,
        path: "/",
      });
      await writeAudit(db, {
        actorUserId: null,
        action: "portal.login",
        targetType: "session",
        targetId: result.steppedUp ? "step-up" : "new",
        ip: resolveClientIp(c),
        userAgent: c.req.header("user-agent") ?? null,
      });
      return c.redirect("/", 303);
    } catch (error) {
      deleteCookie(c, bridgeCookieName, { path: "/auth/callback" });
      const code =
        error instanceof HttpGuardError
          ? error.code
          : error instanceof Error && error.message.includes("state")
            ? "state_mismatch"
            : "login_failed";
      return c.redirect(`/?error=${encodeURIComponent(code)}`, 303);
    }
  });

  app.post("/api/auth/logout", requireSession(auth, sessionCookieName), requireCsrf(cookieSecret), async (c) => {
    await auth.destroySession(getCookie(c, sessionCookieName));
    deleteCookie(c, sessionCookieName, { path: "/" });
    const admin = c.get("admin");
    await writeAudit(db, {
      actorUserId: admin.userId,
      action: "portal.logout",
      targetType: "session",
      targetId: admin.userId,
      ip: resolveClientIp(c),
      userAgent: c.req.header("user-agent") ?? null,
    });
    return c.json({});
  });

  app.get(
    "/api/me",
    requireSession(auth, sessionCookieName),
    async (c) => {
      const admin = c.get("admin");
      c.header("Cache-Control", "no-store");
      return c.json({
        userId: admin.userId,
        email: admin.email,
        permissions: [...admin.permissions].sort(),
        csrfToken: csrfTokenFor(cookieSecret, admin.sessionIdHash),
        authTime: admin.authTime.toISOString(),
        stepUpMaxAgeSeconds: config.stepUpMaxAgeSeconds,
      });
    },
  );

  app.put(
    "/api/settings/lockout",
    requireSession(auth, sessionCookieName),
    requireCsrf(cookieSecret),
    requirePermissions("portal.settings.write"),
    requireStepUp(config.stepUpMaxAgeSeconds),
    async (c) => {
      const body = await c.req.json<{ locked?: boolean; confirm?: string }>().catch(() => undefined);
      if (!body || typeof body.locked !== "boolean" || body.confirm !== "LOCK") {
        return c.json({ error: "invalid_request", error_description: "Type LOCK to confirm" }, 400);
      }
      const admin = c.get("admin");
      await setLocked(db, body.locked);
      await writeAudit(db, {
        actorUserId: admin.userId,
        action: body.locked ? "portal.lockout.enabled" : "portal.lockout.disabled",
        targetType: "settings",
        targetId: "lockout",
        beforeState: { locked: !body.locked },
        afterState: { locked: body.locked },
        ip: resolveClientIp(c),
        userAgent: c.req.header("user-agent") ?? null,
      });
      if (config.alertWebhook) {
        sendWebhookAlert(config.alertWebhook.url, config.alertWebhook.secret, {
          event: body.locked ? "portal.lockout.enabled" : "portal.lockout.disabled",
          actor: admin.userId,
          targetType: "settings",
          targetId: "lockout",
        });
      }
      return c.json({ locked: body.locked });
    },
  );

  app.onError((error, c) => {
    if (error instanceof HttpGuardError) {
      return c.json({ error: error.code, error_description: error.message }, error.status as 400);
    }
    console.error("Portal request failed", error);
    return c.json({ error: "server_error", error_description: "The request could not be completed" }, 500);
  });

  return { app, sessionCookieName };
}
