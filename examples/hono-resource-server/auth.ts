import type { MiddlewareHandler } from "hono";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export interface BasisAccessToken extends JWTPayload {
  sub: string;
  client_id: string;
  scope?: string;
  permissions?: string[];
}

export type AuthVariables = {
  basisToken: BasisAccessToken;
};

export function basisAuth(options: { issuer: string; audience: string }): MiddlewareHandler<{
  Variables: AuthVariables;
}> {
  const issuer = options.issuer.replace(/\/$/, "");
  const jwks = createRemoteJWKSet(new URL(`${issuer}/oauth/jwks`));

  return async (c, next) => {
    const authorization = c.req.header("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      return c.json({ error: "invalid_token", error_description: "Bearer token required" }, 401, {
        "WWW-Authenticate": "Bearer",
      });
    }
    try {
      const { payload, protectedHeader } = await jwtVerify(authorization.slice(7), jwks, {
        algorithms: ["RS256"],
        issuer,
        audience: options.audience,
        typ: "at+jwt",
      });
      if (!payload.sub || typeof payload.client_id !== "string") {
        throw new Error("Required access-token claims are missing");
      }
      c.set("basisToken", payload as BasisAccessToken);
      await next();
    } catch {
      return c.json({ error: "invalid_token", error_description: "Access token is invalid" }, 401, {
        "WWW-Authenticate": 'Bearer error="invalid_token"',
      });
    }
  };
}

export function requireScopes(...required: string[]): MiddlewareHandler<{
  Variables: AuthVariables;
}> {
  return async (c, next) => {
    const granted = new Set((c.get("basisToken").scope ?? "").split(" ").filter(Boolean));
    if (!required.every((scope) => granted.has(scope))) {
      return c.json({ error: "insufficient_scope" }, 403, {
        "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${required.join(" ")}"`,
      });
    }
    await next();
  };
}

export function requirePermissions(...required: string[]): MiddlewareHandler<{
  Variables: AuthVariables;
}> {
  return async (c, next) => {
    const granted = new Set(c.get("basisToken").permissions ?? []);
    if (!required.every((permission) => granted.has(permission))) {
      return c.json({ error: "insufficient_permissions" }, 403);
    }
    await next();
  };
}
