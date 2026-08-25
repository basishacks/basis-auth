import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { AppConfig } from "./config.js";
import type { IdentityService } from "./identity.js";
import type { MicrosoftService } from "./microsoft.js";
import type { KeyService } from "./oauth/keys.js";
import type { OAuthService } from "./oauth/service.js";
import type { SessionService } from "./oauth/sessions.js";

const config = {
  environment: "test",
  issuer: "https://auth.example.test",
  cookieKeys: ["a".repeat(32)],
  trustProxy: false,
  rateLimits: { tokenPerMinute: 1000, authorizePerMinute: 1000, interactionPerMinute: 1000, callbackMaxFailures: 10 },
} as unknown as AppConfig;

const app = createApp(
  config,
  {} as OAuthService,
  { publicJwks: { keys: [{ kty: "RSA", kid: "kid-1" }] } } as unknown as KeyService,
  {} as SessionService,
  {} as IdentityService,
  {} as MicrosoftService,
);

describe("protocol metadata surface", () => {
  it("exposes the revocation endpoint on both discovery documents", async () => {
    for (const path of ["/.well-known/openid-configuration", "/.well-known/oauth-authorization-server"]) {
      const response = await app.request(path);
      const metadata: any = await response.json();
    }
  });

  it("lists only RS256 signing algorithms", async () => {
    const response = await app.request("/.well-known/openid-configuration");
    const metadata: any = await response.json();
  });

  it("serves jwks with short-lived caching and revalidation", async () => {
    const response = await app.request("/oauth/jwks");
    const cache = response.headers.get("cache-control") ?? "";
    expect(cache).toContain("max-age=300");
    expect(cache).toContain("stale-while-revalidate=300");
  });
});

describe("error envelope consistency", () => {
  it("shapes unknown-route errors like OAuth errors", async () => {
    const response = await app.request("/nope");
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(Object.keys(body)).toEqual(["error", "error_description"]);
  });

  it("keeps userinfo errors inside the invalid_token namespace", async () => {
    const response = await app.request("/oauth/userinfo");
    const body = await response.json();
    expect(response.status).toBe(401);
    expect(body.error).toBe("invalid_token");
  });
});


