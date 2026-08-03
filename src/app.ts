import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { serveStatic } from "@hono/node-server/serve-static";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Hono, type Context } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { AppConfig } from "./config.js";
import type { KeyService } from "./oauth/keys.js";
import { OAuthError } from "./oauth/errors.js";
import type { OAuthService } from "./oauth/service.js";
import type { SessionService } from "./oauth/sessions.js";
import type { MicrosoftService } from "./microsoft.js";

const SSO_COOKIE = "basis_sso";
const INTERACTION_COOKIE = "basis_bridge_id";

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

function statusPage(title: string, message: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title} · Basis Auth</title>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`;
}

function acceptsHtml(c: Context) {
  return c.req.method === "GET" && c.req.header("accept")?.includes("text/html");
}

export function createApp(
  config: AppConfig,
  oauth: OAuthService,
  keys: KeyService,
  sessions: SessionService,
  microsoft: MicrosoftService,
) {
  const app = new Hono();
  const cookieOptions = {
    httpOnly: true,
    secure: config.environment === "production",
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
  const interactionPage = (uid: string) => `${config.uiOrigin}/oauth/interaction/${uid}`;

  app.use("*", secureHeaders());
  app.get("/health", (c) => c.json({ status: "ok" }));

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

  app.get("/oauth/authorize", async (c) => {
    const sso = await sessions.find(getCookie(c, SSO_COOKIE));
    const started = await oauth.startAuthorization({
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
    setCookie(c, INTERACTION_COOKIE, started.interactionToken, {
      ...cookieOptions,
      path: "/oauth",
      maxAge: 10 * 60,
    });
    const { request, client } = await oauth.interaction(started.id, started.interactionToken);
    if (request.userId && !(await oauth.requiresConsent(request, client))) {
      deleteCookie(c, INTERACTION_COOKIE, { path: "/oauth" });
      return c.redirect(await oauth.completeAuthorization(request.id), 303);
    }
    return c.redirect(interactionPage(started.id), 303);
  });

  app.get("/oauth/interaction/:uid/details", async (c) => {
    const uid = c.req.param("uid");
    const { request, client } = await oauth.interaction(uid, getCookie(c, INTERACTION_COOKIE));
    if (request.userId && !(await oauth.requiresConsent(request, client))) {
      deleteCookie(c, INTERACTION_COOKIE, { path: "/oauth" });
      return c.json({ redirectTo: await oauth.completeAuthorization(request.id) });
    }
    return c.json({
      uid,
      prompt: request.userId ? "consent" : "login",
      client: { id: client.clientId, name: client.metadata.name },
      scopes: request.scopes,
      resources: [request.resource],
      accountId: request.userId,
      csrfToken: csrfToken(uid),
      microsoftConfigured: Boolean(config.microsoft),
    });
  });

  app.post("/oauth/interaction/:uid/consent", async (c) => {
    const uid = c.req.param("uid");
    if (!csrfValid(uid, c.req.header("x-csrf-token"))) {
      return c.json({ error: "invalid_csrf_token" }, 403);
    }
    const { request } = await oauth.interaction(uid, getCookie(c, INTERACTION_COOKIE));
    const body = await c.req.json<{ action?: string }>();
    if (body.action === "deny") {
      deleteCookie(c, INTERACTION_COOKIE, { path: "/oauth" });
      return c.json({ redirectTo: await oauth.denyAuthorization(request) });
    }
    if (body.action !== "allow") return c.json({ error: "invalid_action" }, 400);
    await oauth.grantConsent(request);
    deleteCookie(c, INTERACTION_COOKIE, { path: "/oauth" });
    return c.json({ redirectTo: await oauth.completeAuthorization(request.id) });
  });

  app.get("/oauth/upstream/microsoft", async (c) => {
    const uid = c.req.query("uid");
    if (!uid) throw new OAuthError("invalid_request", "Interaction uid is required");
    const { request } = await oauth.interaction(uid, getCookie(c, INTERACTION_COOKIE));
    if (request.userId) throw new OAuthError("invalid_request", "User is already authenticated");
    return c.redirect((await microsoft.begin(request.id)).href, 302);
  });

  app.get("/oauth/callback/microsoft", async (c) => {
    const incoming = new URL(c.req.url);
    const callbackUrl = new URL(`${incoming.pathname}${incoming.search}`, config.issuer);
    const result = await microsoft.callback(callbackUrl);
    const sessionToken = await sessions.create(result.user.id);
    setCookie(c, SSO_COOKIE, sessionToken, { ...cookieOptions, maxAge: 30 * 24 * 60 * 60 });
    await oauth.attachUser(result.authorizationRequestId, result.user.id, new Date());
    const { request, client } = await oauth.interaction(
      result.authorizationRequestId,
      getCookie(c, INTERACTION_COOKIE),
    );
    if (!(await oauth.requiresConsent(request, client))) {
      deleteCookie(c, INTERACTION_COOKIE, { path: "/oauth" });
      return c.redirect(await oauth.completeAuthorization(request.id), 303);
    }
    return c.redirect(interactionPage(request.id), 303);
  });

  app.post("/oauth/token", async (c) => {
    const body = await c.req.parseBody();
    const credentials = clientCredentials(c, body);
    const grantType = formValue(body, "grant_type");
    let response: Record<string, unknown>;
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
    return c.json(response);
  });

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

  app.post("/oauth/revoke", async (c) => {
    const body = await c.req.parseBody();
    const token = formValue(body, "token");
    const credentials = clientCredentials(c, body);
    if (!token) throw new OAuthError("invalid_request", "token is required");
    await oauth.revoke(token, credentials.clientId, credentials.clientSecret);
    return c.body(null, 200);
  });

  const logout = async (c: Context) => {
    await sessions.destroy(getCookie(c, SSO_COOKIE));
    deleteCookie(c, SSO_COOKIE, { path: "/" });
    return c.redirect("/signed-out", 303);
  };
  app.get("/oauth/logout", logout);
  app.post("/oauth/logout", logout);

  if (config.environment !== "test") {
    app.use("/assets/*", serveStatic({ root: "./web/dist" }));
  }
  const serveIndex = async (c: Context) => c.html(await readFile("./web/dist/index.html", "utf8"));
  app.get("/", serveIndex);
  app.get("/oauth/interaction/:uid", serveIndex);
  app.get("/signed-out", serveIndex);
  app.notFound(async (c) => {
    const path = new URL(c.req.url).pathname;
    const isFrontendPath = !path.startsWith("/oauth/") && !path.startsWith("/.well-known/") && !path.startsWith("/assets/");
    if (isFrontendPath && acceptsHtml(c)) {
      return c.html(statusPage("Page not found", "The page you requested does not exist or has moved."), 404);
    }
    return c.json({ error: "not_found", error_description: "The requested resource does not exist" }, 404);
  });

  app.onError((error, c) => {
    console.error("Request failed", error);
    if (error instanceof OAuthError) {
      if (error.status === 401) c.header("WWW-Authenticate", `Basic realm="${config.issuer}"`);
      return c.json(error.toJSON(), error.status as 400);
    }
    if (acceptsHtml(c)) {
      return c.html(statusPage("Something went wrong", "Basis Auth could not complete this request. Please try again."), 500);
    }
    return c.json({ error: "server_error", error_description: "The request could not be completed" }, 500);
  });
  return app;
}
