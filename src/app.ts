import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { serveStatic } from "@hono/node-server/serve-static";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Hono, type Context } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { AppConfig } from "./config.js";
import type { IdentityService } from "./identity.js";
import type { KeyService } from "./oauth/keys.js";
import { OAuthError } from "./oauth/errors.js";
import type { OAuthService } from "./oauth/service.js";
import { assertClientEmailAccess } from "./oauth/service.js";
import type { SessionService } from "./oauth/sessions.js";
import type { MicrosoftService } from "./microsoft.js";
import { applyImageResponseHeaders } from "./security/pictureHeaders.js";
import {
  createFailureBackoff,
  createRateLimiter,
  rateLimitMiddleware,
} from "./security/rateLimit.js";
import { createClientIpResolver } from "./security/ip.js";

const SSO_COOKIE = "basis_sso";
const INTERACTION_COOKIE = "basis_bridge_id";
const ERROR_COOKIE = "basis_bridge_error";

function formValue(body: Record<string, string | File | (string | File)[]>, key: string) {
  const value = body[key];
  return typeof value === "string" ? value : undefined;
}

function clientCredentials(c: Context, body: Record<string, string | File | (string | File)[]>) {
  const authorization = c.req.header("authorization");
  if (authorization?.startsWith("Basic ")) {
    let decoded: string;
    try {
      decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    } catch {
      throw new OAuthError("invalid_client", "Malformed client authorization", 401);
    }
    const separator = decoded.indexOf(":");
    if (separator < 1) throw new OAuthError("invalid_client", "Malformed client authorization", 401);
    const decode = (value: string) => {
      try {
        return decodeURIComponent(value.replace(/\+/g, " "));
      } catch {
        throw new OAuthError("invalid_client", "Malformed client authorization", 401);
      }
    };
    return {
      clientId: decode(decoded.slice(0, separator)),
      clientSecret: decode(decoded.slice(separator + 1)),
    };
  }
  if (formValue(body, "client_secret")) {
    throw new OAuthError("invalid_client", "Use client_secret_basic for confidential clients", 401);
  }
  return { clientId: formValue(body, "client_id") ?? "", clientSecret: undefined };
}

/**
 * Base64 that survives arbitrary Unicode payloads. btoa throws for any code
 * point above U+00FF, and upstream error strings routinely contain curly
 * quotes and other non-Latin1 characters.
 */
function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function statusPage(title: string, description: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body style="font-family:sans-serif;text-align:center;padding:4rem"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></body></html>`;
}

export function createApp(
  config: AppConfig,
  oauth: OAuthService,
  keys: KeyService,
  sessions: SessionService,
  identity: IdentityService,
  microsoft: MicrosoftService,
  hooks?: {
    recordAuthEvent?: (event: {
      userId?: string | null;
      kind: "sign_in" | "sign_in_failure" | "token_issued" | "token_refreshed" | "token_refresh_rejected" | "logout";
      provider?: string | null;
      clientId?: string | null;
      success?: boolean;
      ip?: string | null;
      userAgent?: string | null;
    }) => Promise<void>;
  },
) {
  const app = new Hono();
  // Browsers enforce the __Host- prefix only over HTTPS, so production gets
  // the hardened names while development and tests keep plain cookie names.
  const secureCookies = config.environment === "production";
  const SSO_COOKIE_NAME = secureCookies ? `__Host-${SSO_COOKIE}` : SSO_COOKIE;
  const INTERACTION_COOKIE_NAME = secureCookies ? `__Host-${INTERACTION_COOKIE}` : INTERACTION_COOKIE;
  const ERROR_COOKIE_NAME = secureCookies ? `__Host-${ERROR_COOKIE}` : ERROR_COOKIE;
  const resolveClientIp = createClientIpResolver(config.trustProxy);

  const tokenLimiter = createRateLimiter({ windowMs: 60_000, limit: config.rateLimits.tokenPerMinute });
  const authorizeLimiter = createRateLimiter({ windowMs: 60_000, limit: config.rateLimits.authorizePerMinute });
  const interactionLimiter = createRateLimiter({ windowMs: 60_000, limit: config.rateLimits.interactionPerMinute });
  const callbackFailures = createRateLimiter({
    windowMs: 5 * 60_000,
    limit: config.rateLimits.callbackMaxFailures,
  });
  const clientAuthBackoff = createFailureBackoff({ threshold: 5, baseMs: 1_000, maxMs: 15 * 60_000 });

  const cookieOptions = {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "Lax" as const,
    path: "/",
  };
  const csrfToken = (uid: string) =>
    createHmac("sha256", config.cookieKeys[0]!).update(`interaction:${uid}`).digest("base64url");
  const csrfValid = (uid: string, value?: string) => {
    if (!value) return false;
    const expected = Buffer.from(csrfToken(uid));
    const supplied = Buffer.from(value);
    return expected.length === supplied.length && timingSafeEqual(expected, supplied);
  };
  const errorPayload = (error: unknown) => {
    if (error instanceof OAuthError) return error.toJSON();
    // Raw backend error strings can leak internals; production responses are generic.
    return {
      status: 500,
      error: "server_error",
      code: 50040,
      error_description:
        config.environment === "development"
          ? error instanceof Error
            ? error.message
            : String(error)
          : "The request could not be completed",
    };
  };

  // The SPA shell is served for several routes; caching it removes a disk
  // round trip from every authorization request in production while a
  // fallback keeps the server usable before the first UI build exists.
  const FALLBACK_INDEX_HTML =
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Basis Auth</title></head><body style="font-family:sans-serif;text-align:center;padding:4rem"><h1>Basis Auth</h1><p>The sign-in interface is not built yet. Run <code>npm run build:web</code>.</p></body></html>';
  let cachedIndexHtml: Promise<string> | undefined;
  const loadIndexHtml = (): Promise<string> => {
    if (config.environment === "production") {
      cachedIndexHtml ??= readFile("./web/dist/index.html", "utf8").catch(() => FALLBACK_INDEX_HTML);
      return cachedIndexHtml;
    }
    return readFile("./web/dist/index.html", "utf8").catch(() => FALLBACK_INDEX_HTML);
  };

  const originalAuthorizationUri = async (c: Context) => {
    try {
      const request = await oauth.getAuthorization(getCookie(c, INTERACTION_COOKIE_NAME)!);
      return request.initialUri.startsWith("/oauth/authorize")
        ? request.initialUri
        : "/oauth/authorize";
    } catch {
      return "/oauth/authorize";
    }
  };
  const frontendFlowError = async (c: Context, error: unknown) => {
    const redirectTo = await originalAuthorizationUri(c);
    setCookie(c, ERROR_COOKIE_NAME, encodeBase64Utf8(JSON.stringify(errorPayload(error))), {
      ...cookieOptions,
      httpOnly: false,
      path: "/oauth",
      maxAge: 10 * 60,
    });
    if (c.req.header("accept")?.includes("application/json")) {
      return c.json({ redirectTo });
    }
    return c.redirect(redirectTo, 303);
  };

  app.use("*", secureHeaders());
  app.get("/health", (c) => c.json({ status: "ok" }));

  async function currentSession(c: Context) {
    const session = await sessions.find(getCookie(c, SSO_COOKIE_NAME));
    if (!session) return undefined;
    const user = await identity.findUser(session.userId);
    if (!user || user.disabled) return undefined;
    return { session, user };
  }

  app.get("/api/me", async (c) => {
    const current = await currentSession(c);
    if (!current) return c.json({ error: "unauthorized" }, 401);
    const { session, user } = current;
    c.header("Cache-Control", "no-store");
    return c.json({
      id: user.id,
      provider: user.provider,
      name: user.displayName,
      email: user.email,
      emailVerified: user.emailVerified,
      loginExpiresAt: session.expiresAt.toISOString(),
      picture: user.hasPicture ? `/api/picture/${user.id}` : null,
    });
  });

  app.get("/api/picture/:userId", async (c) => {
    const picture = await identity.fetchProfilePicture(c.req.param("userId"));
    if (!picture) {
      return c.json({ error: "not_found" }, 404);
    }
    c.header("Cache-Control", "public, max-age=300");
    applyImageResponseHeaders(c, picture.contentType, "avatar");
    return c.body(new Uint8Array(picture.data));
  });

  app.get("/.well-known/openid-configuration", (c) =>
    c.json({
      issuer: config.issuer,
      authorization_endpoint: `${config.issuer}/oauth/authorize`,
      token_endpoint: `${config.issuer}/oauth/token`,
      userinfo_endpoint: `${config.issuer}/oauth/userinfo`,
      jwks_uri: `${config.issuer}/oauth/jwks`,
      revocation_endpoint: `${config.issuer}/oauth/revoke`,
      revocation_endpoint_auth_methods_supported: ["client_secret_basic", "none"],
      end_session_endpoint: `${config.issuer}/oauth/logout`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      token_endpoint_auth_methods_supported: ["client_secret_basic", "none"],
      scopes_supported: ["openid", "profile", "email", "permissions", "offline_access"],
      claims_supported: ["sub", "name", "picture", "email", "email_verified", "permissions"],
      code_challenge_methods_supported: ["S256"],
      prompt_values_supported: ["login"],
    }),
  );
  app.get("/.well-known/oauth-authorization-server", (c) =>
    c.json({
      issuer: config.issuer,
      authorization_endpoint: `${config.issuer}/oauth/authorize`,
      token_endpoint: `${config.issuer}/oauth/token`,
      jwks_uri: `${config.issuer}/oauth/jwks`,
      revocation_endpoint: `${config.issuer}/oauth/revoke`,
      revocation_endpoint_auth_methods_supported: ["client_secret_basic", "none"],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["client_secret_basic", "none"],
      code_challenge_methods_supported: ["S256"],
      prompt_values_supported: ["login"],
    }),
  );
  app.get("/oauth/jwks", (c) => {
    c.header("Cache-Control", "public, max-age=300, stale-while-revalidate=300");
    return c.json(keys.publicJwks);
  });

  app.use("/oauth/token", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("Pragma", "no-cache");
    await next();
  });
  app.use("/oauth/revoke", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });

  const requestSizeGuard = bodyLimit({
    maxSize: config.bodyLimitBytes,
    onError: (c) =>
      c.json({ error: "invalid_request", error_description: "Request body is too large" }, 413),
  });

  app.get(
    "/oauth/authorize",
    rateLimitMiddleware(authorizeLimiter, (c) => resolveClientIp(c)),
    async (c) => {
      const initialUrl = new URL(c.req.url);
      const initialUri = initialUrl.pathname + initialUrl.search;
      const interactionToken = getCookie(c, INTERACTION_COOKIE_NAME);
      const bridgeError = getCookie(c, ERROR_COOKIE_NAME);
      if (interactionToken) {
        try {
          const request = await oauth.getAuthorization(interactionToken);
          if (request.initialUri === initialUri) {
            return c.html(await loadIndexHtml());
          }
          deleteCookie(c, INTERACTION_COOKIE_NAME, { path: "/oauth" });
          deleteCookie(c, ERROR_COOKIE_NAME, { path: "/oauth" });
        } catch (error) {
          if (!(error instanceof OAuthError)) throw error;
          deleteCookie(c, INTERACTION_COOKIE_NAME, { path: "/oauth" });
          if (bridgeError) return c.html(await loadIndexHtml());
          deleteCookie(c, ERROR_COOKIE_NAME, { path: "/oauth" });
        }
      } else if (bridgeError) {
        return c.html(await loadIndexHtml());
      } else {
        deleteCookie(c, ERROR_COOKIE_NAME, { path: "/oauth" });
      }

      // OIDC re-authentication signals: prompt=login always forces a fresh
      // login, and max_age forces one when the existing authentication is
      // older than the requested window.
      const promptValue = initialUrl.searchParams.get("prompt");
      const maxAgeRaw = initialUrl.searchParams.get("max_age");
      const forceFreshLogin = promptValue === "login";
      const maxAgeSeconds = maxAgeRaw === null ? undefined : Number(maxAgeRaw);

      const ssoCookie = getCookie(c, SSO_COOKIE_NAME);
      let sso = forceFreshLogin ? undefined : await sessions.find(ssoCookie);
      if (
        sso &&
        maxAgeSeconds !== undefined &&
        Number.isFinite(maxAgeSeconds) &&
        maxAgeSeconds >= 0 &&
        (Date.now() - sso.authenticatedAt.getTime()) / 1000 > maxAgeSeconds
      ) {
        sso = undefined;
      }

      let started;
      try {
        started = await oauth.startAuthorization({
          initialUri,
          clientId: c.req.query("client_id"),
          redirectUri: c.req.query("redirect_uri"),
          responseType: c.req.query("response_type"),
          scope: c.req.query("scope"),
          resources: c.req.queries("resource") ?? [],
          state: c.req.query("state"),
          nonce: c.req.query("nonce"),
          codeChallenge: c.req.query("code_challenge"),
          codeChallengeMethod: c.req.query("code_challenge_method"),
          session: sso ? { userId: sso.userId, authenticatedAt: sso.authenticatedAt } : undefined,
        });
      } catch (error) {
        setCookie(c, ERROR_COOKIE_NAME, encodeBase64Utf8(JSON.stringify(errorPayload(error))), {
          ...cookieOptions,
          httpOnly: false,
          path: "/oauth",
          maxAge: 10 * 60,
        });
        return c.html(await loadIndexHtml());
      }

      setCookie(c, INTERACTION_COOKIE_NAME, started.interactionToken, {
        ...cookieOptions,
        path: "/oauth",
        maxAge: 10 * 60,
      });

      console.log("start auth [redacted]");

      return c.html(await loadIndexHtml());
    },
  );

  app.get("/oauth/interaction", async (c) => {
    const bridgeToken = getCookie(c, INTERACTION_COOKIE_NAME);
    if (!bridgeToken) throw new OAuthError("invalid_request", "Interaction cookie is missing");
    const request = await oauth.getAuthorization(bridgeToken);
    const client = await oauth.getClient(request.clientId);
    return c.json({
      uid: request.id,
      prompt: request.userId ? "consent" : "login",
      client,
      scopes: request.scopes,
      resources: [request.resource],
      accountId: request.userId,
      csrfToken: csrfToken(request.id),
      microsoftConfigured: Boolean(config.microsoft),
    });
  });

  app.post(
    "/oauth/interaction/:uid/consent",
    rateLimitMiddleware(interactionLimiter, (c) => resolveClientIp(c)),
    async (c) => {
      const uid = c.req.param("uid");
      if (!csrfValid(uid, c.req.header("x-csrf-token"))) {
        return c.json({ error: "invalid_csrf_token" }, 403);
      }
      const { request } = await oauth.interaction(uid, getCookie(c, INTERACTION_COOKIE_NAME));
      const body = await c.req.json<{ action?: string }>();
      if (body.action === "deny") {
        const redirectTo = await oauth.denyAuthorization(request);
        deleteCookie(c, INTERACTION_COOKIE_NAME, { path: "/oauth" });
        return c.json({ redirectTo });
      }
      if (body.action !== "allow") return c.json({ error: "invalid_action" }, 400);
      await oauth.grantConsent(request);
      const redirectTo = await oauth.completeAuthorization(request.id);
      deleteCookie(c, INTERACTION_COOKIE_NAME, { path: "/oauth" });
      return c.json({ redirectTo });
    },
  );

  app.get(
    "/oauth/upstream/microsoft",
    rateLimitMiddleware(interactionLimiter, (c) => resolveClientIp(c)),
    async (c) => {
      try {
        const uid = c.req.query("uid");
        if (!uid) throw new OAuthError("invalid_request", "Interaction is not found or expired");
        const { request } = await oauth.interaction(uid, getCookie(c, INTERACTION_COOKIE_NAME));
        if (request.userId) throw new OAuthError("invalid_request", "User is already authenticated");
        const redirectTo = (await microsoft.begin(request.id)).href;
        if (c.req.header("accept")?.includes("application/json")) {
          return c.json({ redirectTo });
        }
        return c.redirect(redirectTo, 302);
      } catch (error: unknown) {
        return frontendFlowError(c, "Upstream Error: " + String(error));
      }
    },
  );

  app.get("/oauth/callback/microsoft", async (c) => {
    try {
      const incoming = new URL(c.req.url);
      const callbackUrl = new URL(`${incoming.pathname}${incoming.search}`, config.issuer);
      const result = await microsoft.callback(callbackUrl);
      const { request, client } = await oauth.interaction(
        result.authorizationRequestId,
        getCookie(c, INTERACTION_COOKIE_NAME),
      );
      if (result.user.disabled) {
        throw new OAuthError(
          "access_denied",
          "This account is not allowed to sign in to this application.",
          403,
        );
      }
      // Same enforcement as the SSO-session path; defense in depth for
      // freshly authenticated users.
      if (client?.filterMode) assertClientEmailAccess(client, result.user.email);
      await hooks?.recordAuthEvent?.({
        userId: result.user.id,
        kind: "sign_in",
        provider: "basischina-microsoft",
        ip: resolveClientIp(c),
        userAgent: c.req.header("user-agent") ?? null,
      });
      const sessionToken = await sessions.create(result.user.id);
      setCookie(c, SSO_COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: 30 * 24 * 60 * 60 });
      await oauth.attachUser(result.authorizationRequestId, result.user.id, new Date());
      return c.redirect(request.initialUri, 303);
    } catch (error: unknown) {
      const ip = resolveClientIp(c);
      callbackFailures.limit(`microsoft-callback:${ip}`);
      await hooks?.recordAuthEvent?.({
        kind: "sign_in_failure",
        provider: "basischina-microsoft",
        success: false,
        ip,
        userAgent: c.req.header("user-agent") ?? null,
      });
      return frontendFlowError(
        c,
        error instanceof OAuthError ? error : "Upstream Error: " + String(error),
      );
    }
  });

  app.post(
    "/oauth/token",
    requestSizeGuard,
    rateLimitMiddleware(tokenLimiter, (c) => resolveClientIp(c)),
    async (c) => {
      const body = await c.req.parseBody();
      const credentials = clientCredentials(c, body);
      const ip = resolveClientIp(c);
      const blockedForMs = clientAuthBackoff.check(`${credentials.clientId}:${ip}`);
      if (blockedForMs > 0) {
        c.header("Retry-After", String(Math.ceil(blockedForMs / 1000)));
        throw new OAuthError("invalid_client", "Too many failed attempts. Try again later.", 429);
      }
      const grantType = formValue(body, "grant_type");
      let response: Record<string, unknown>;
      try {
        if (grantType === "authorization_code") {
          const code = formValue(body, "code");
          if (!code) throw new OAuthError("invalid_request", "code is required");
          response = await oauth.exchangeAuthorizationCode({
            code,
            ...credentials,
            redirectUri: formValue(body, "redirect_uri"),
            codeVerifier: formValue(body, "code_verifier"),
          });
        } else if (grantType === "refresh_token") {
          const refreshToken = formValue(body, "refresh_token");
          if (!refreshToken) throw new OAuthError("invalid_request", "refresh_token is required");
          response = await oauth.exchangeRefreshToken({ refreshToken, ...credentials });
        } else {
          throw new OAuthError("unsupported_grant_type", "Unsupported grant_type");
        }
      } catch (error) {
        if (error instanceof OAuthError && error.status === 401) {
          clientAuthBackoff.record(`${credentials.clientId}:${ip}`);
        }
        throw error;
      }
      clientAuthBackoff.reset(`${credentials.clientId}:${ip}`);
      return c.json(response);
    },
  );

  const userInfo = async (c: Context) => {
    const authorization = c.req.header("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      throw new OAuthError("invalid_token", "Bearer access token is required", 401);
    }
    c.header("Cache-Control", "no-store");
    return c.json(await oauth.userInfo(authorization.slice(7)));
  };
  app.get("/oauth/userinfo", userInfo);
  app.post("/oauth/userinfo", userInfo);

  app.post(
    "/oauth/revoke",
    requestSizeGuard,
    rateLimitMiddleware(tokenLimiter, (c) => resolveClientIp(c)),
    async (c) => {
      const body = await c.req.parseBody();
      const token = formValue(body, "token");
      const credentials = clientCredentials(c, body);
      if (!token) throw new OAuthError("invalid_request", "token is required");
      await oauth.revoke(token, credentials.clientId, credentials.clientSecret);
      return c.body(null, 200);
    },
  );

  const logout = async (c: Context) => {
    const current = await sessions.find(getCookie(c, SSO_COOKIE_NAME));
    await sessions.destroy(getCookie(c, SSO_COOKIE_NAME));
    deleteCookie(c, SSO_COOKIE_NAME, { path: "/" });
    if (current) {
      await hooks?.recordAuthEvent?.({
        userId: current.userId,
        kind: "logout",
        ip: resolveClientIp(c),
      });
    }
    const interactionToken = getCookie(c, INTERACTION_COOKIE_NAME);
    let redirectTo = "/oauth/authorize";
    if (interactionToken) {
      // Sign-out must succeed even when the interaction already expired.
      try {
        const request = await oauth.getAuthorization(interactionToken);
        await oauth.clearInteractionUser(request.id);
        redirectTo = request.initialUri;
      } catch {
        redirectTo = "/oauth/authorize";
      }
    }
    if (c.req.header("accept")?.includes("application/json")) return c.json({});
    return c.redirect(redirectTo, 303);
  };
  app.get("/oauth/logout", logout);
  app.post("/oauth/logout", logout);

  if (config.environment !== "test") {
    app.use(
      "/assets/*",
      serveStatic({
        root: "./web/dist",
        onFound: (path, c) => {
          // Content-hashed filenames allow aggressive caching.
          if (path.includes("/assets/")) {
            c.header("Cache-Control", "public, max-age=31536000, immutable");
          }
        },
      }),
    );
    app.use("/fonts/*", serveStatic({ root: "./web/dist" }));
  }
  app.notFound(async (c) => {
    return c.json({ error: "not_found", error_description: "The requested resource does not exist" }, 404);
  });

  app.onError((error, c) => {
    console.error("Request failed", error);
    if (error instanceof OAuthError) {
      return c.json(error.toJSON(), error.status as 400);
    }
    if (c.req.method === "GET" && c.req.header("accept")?.includes("text/html")) {
      return c.html(statusPage("Something went wrong", "Basis Auth could not complete this request. Please try again."), 500);
    }
    return c.json(
      {
        error: "server_error",
        error_description:
          config.environment === "development"
            ? error instanceof Error
              ? error.message
              : String(error)
            : "The request could not be completed",
      },
      500,
    );
  });
  return app;
}
