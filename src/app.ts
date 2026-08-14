import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { serveStatic } from "@hono/node-server/serve-static";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Hono, type Context } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { AppConfig } from "./config.js";
import type { IdentityService } from "./identity.js";
import type { KeyService } from "./oauth/keys.js";
import { OAuthError } from "./oauth/errors.js";
import type { OAuthService } from "./oauth/service.js";
import type { SessionService } from "./oauth/sessions.js";
import type { MicrosoftService } from "./microsoft.js";

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

function acceptsHtml(c: Context) {
  return c.req.method === "GET" && c.req.header("accept")?.includes("text/html");
}

export function createApp(
  config: AppConfig,
  oauth: OAuthService,
  keys: KeyService,
  sessions: SessionService,
  identity: IdentityService,
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
  const errorPayload = (error: any) =>
    error instanceof OAuthError
      ? error.toJSON()
      : {
          status: 500,
          error: "server_error",
          code: 50040,
          error_description: error.toString(),
        };
  const originalAuthorizationUri = async (c: Context) => {
    try {
      const request = await oauth.getAuthorization(getCookie(c, INTERACTION_COOKIE)!);
      return request.initialUri.startsWith("/oauth/authorize")
        ? request.initialUri
        : "/oauth/authorize";
    } catch {
      return "/oauth/authorize";
    }
  };
  const frontendFlowError = async (c: Context, error: any) => {
    const redirectTo = await originalAuthorizationUri(c);
    setCookie(c, ERROR_COOKIE, btoa(JSON.stringify(errorPayload(error))), {
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
  // const interactionPage = (uid: string) => `${config.issuer}/oauth/interaction/${uid}`;

  app.use("*", secureHeaders());
  app.get("/health", (c) => c.json({ status: "ok" }));

  async function currentSession(c: Context) {
    const session = await sessions.find(getCookie(c, SSO_COOKIE));
    if (!session) return undefined;
    const user = await identity.findUser(session.userId);
    return user ? { session, user } : undefined;
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
      picture: user.picture && user.pictureContentType ? `/api/picture/${user.id}` : null,
    });
  });

  app.get("/api/picture/:userId", async (c) => {
    const user = await identity.findUser(c.req.param("userId"));
    if (!user?.picture || !user.pictureContentType) {
      return c.json({ error: "not_found" }, 404);
    }
    c.header("Cache-Control", "public, max-age=300");
    c.header("Content-Type", user.pictureContentType);
    return c.body(new Uint8Array(user.picture));
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
    const initialUrl = new URL(c.req.url);
    const initialUri = initialUrl.pathname + initialUrl.search;
    const interactionToken = getCookie(c, INTERACTION_COOKIE);
    const bridgeError = getCookie(c, ERROR_COOKIE);
    if (interactionToken) {
      try {
        const request = await oauth.getAuthorization(interactionToken);
        if (request.initialUri === initialUri) {
          return c.html(await readFile("./web/dist/index.html", "utf8"));
        }
        deleteCookie(c, INTERACTION_COOKIE, { path: "/oauth" });
        deleteCookie(c, ERROR_COOKIE, { path: "/oauth" });
      } catch (error) {
        if (!(error instanceof OAuthError)) throw error;
        deleteCookie(c, INTERACTION_COOKIE, { path: "/oauth" });
        if (bridgeError) return c.html(await readFile("./web/dist/index.html", "utf8"));
        deleteCookie(c, ERROR_COOKIE, { path: "/oauth" });
      }
    } else if (bridgeError) {
      return c.html(await readFile("./web/dist/index.html", "utf8"));
    } else {
      deleteCookie(c, ERROR_COOKIE, { path: "/oauth" });
    }

    const sso = await sessions.find(getCookie(c, SSO_COOKIE));
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
      setCookie(c, ERROR_COOKIE, btoa(JSON.stringify(errorPayload(error))), {
        ...cookieOptions,
        httpOnly: false,
        path: "/oauth",
        maxAge: 10 * 60,
      });
      return c.html(await readFile("./web/dist/index.html", "utf8"));
    }

    setCookie(c, INTERACTION_COOKIE, started.interactionToken, {
      ...cookieOptions,
      path: "/oauth",
      maxAge: 10 * 60,
    });

    console.log("start auth", started.interactionToken)

    // const { request, client } = await oauth.interaction(started.id, started.interactionToken);
    // if (request.userId && !(await oauth.requiresConsent(request, client))) {
    //   deleteCookie(c, INTERACTION_COOKIE, { path: "/oauth" });
    //   return c.html(await readFile("./web/dist/index.html", "utf8"))
    // }
    return c.html(await readFile("./web/dist/index.html", "utf8"))
  });

  // app.get("/oauth/interaction", async (c) => {
  //   const interaction = await oauth.getAuthorization(getCookie(c, INTERACTION_COOKIE)!);
  //   console.log("interaction", interaction)

  // })

  // dep
  app.get("/oauth/interaction", async (c) => {
    const bridgeToken = getCookie(c, INTERACTION_COOKIE);
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

  app.post("/oauth/interaction/:uid/consent", async (c) => {
    const uid = c.req.param("uid");
    if (!csrfValid(uid, c.req.header("x-csrf-token"))) {
      return c.json({ error: "invalid_csrf_token" }, 403);
    }
    const { request } = await oauth.interaction(uid, getCookie(c, INTERACTION_COOKIE));
    const body = await c.req.json<{ action?: string }>();
    if (body.action === "deny") {
      const redirectTo = await oauth.denyAuthorization(request);
      deleteCookie(c, INTERACTION_COOKIE, { path: "/oauth" });
      return c.json({ redirectTo });
    }
    if (body.action !== "allow") return c.json({ error: "invalid_action" }, 400);
    await oauth.grantConsent(request);
    const redirectTo = await oauth.completeAuthorization(request.id);
    deleteCookie(c, INTERACTION_COOKIE, { path: "/oauth" });
    return c.json({ redirectTo });
  });


  // dep

  app.get("/oauth/upstream/microsoft", async (c) => {
    try {
      const uid = c.req.query("uid");
      if (!uid) throw new OAuthError("invalid_request", "Interaction uid is required");
      const { request } = await oauth.interaction(uid, getCookie(c, INTERACTION_COOKIE));
      if (request.userId) throw new OAuthError("invalid_request", "User is already authenticated");
      const redirectTo = (await microsoft.begin(request.id)).href;
      if (c.req.header("accept")?.includes("application/json")) {
        return c.json({ redirectTo });
      }
      return c.redirect(redirectTo, 302);
    } catch (error: any) {
      console.log(error)
      return frontendFlowError(c, "Upstream Error: " + error.toString());
    }
  });

  app.get("/oauth/callback/microsoft", async (c) => {
    try {
      const incoming = new URL(c.req.url);
      const callbackUrl = new URL(`${incoming.pathname}${incoming.search}`, config.issuer);
      const result = await microsoft.callback(callbackUrl);
      const { request, client } = await oauth.interaction(
        result.authorizationRequestId,
        getCookie(c, INTERACTION_COOKIE),
      );
      const filteredEmail = result.user.email.trim().toLowerCase();
      const filterContent = client?.filterContent ?? [];
      const matchesFilter = filterContent.includes(filteredEmail);
      if (
        result.user.disabled ||
        (client?.filterMode === "whitelist" && !matchesFilter) ||
        (client?.filterMode === "blacklist" && matchesFilter)
      ) {
        throw new OAuthError("access_denied", "This account is not allowed to sign in to this application.", 403);
      }
      const sessionToken = await sessions.create(result.user.id);
      setCookie(c, SSO_COOKIE, sessionToken, { ...cookieOptions, maxAge: 30 * 24 * 60 * 60 });
      await oauth.attachUser(result.authorizationRequestId, result.user.id, new Date());
      return c.redirect(request.initialUri, 303);
    } catch (error: any) {
      return frontendFlowError(
        c,
        error instanceof OAuthError ? error : "Upstream Error: " + error.toString(),
      );
    }
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
    const interactionToken = getCookie(c, INTERACTION_COOKIE);
    let redirectTo = "/oauth/authorize";
    if (interactionToken) {
      const request = await oauth.getAuthorization(interactionToken);
      await oauth.clearInteractionUser(request.id);
      redirectTo = request.initialUri;
    }
    if (c.req.header("accept")?.includes("application/json")) return c.json({});
    return c.redirect(redirectTo, 303);
  };
  app.get("/oauth/logout", logout);
  app.post("/oauth/logout", logout);

  if (config.environment !== "test") {
    app.use("/assets/*", serveStatic({ root: "./web/dist" }));
    app.use("/fonts/*", serveStatic({ root: "./web/dist" }));
  }
  const serveIndex = async (c: Context) => c.html(await readFile("./web/dist/index.html", "utf8"));
  // app.get("/", serveIndex);
  // app.get("/oauth/interaction/:uid", serveIndex);
  // app.get("/signed-out", serveIndex);
  app.notFound(async (c) => {
    return c.json({ error: "not_found", error_description: "The requested resource does not exist" }, 404);
  });

  app.onError((error, c) => {
    console.error("Request failed", error);
    if (error instanceof OAuthError) {
      if (error.status === 401) c.header("WWW-Authenticate", `Bearer`);
      return c.json(error.toJSON(), error.status as 400);
    }
    // if (acceptsHtml(c)) {
    //   return c.html(statusPage("Something went wrong", "Basis Auth could not complete this request. Please try again."), 500);
    // }
    return c.json({ error: "server_error", error_description: "The request could not be completed" }, 500);
  });
  return app;
}
