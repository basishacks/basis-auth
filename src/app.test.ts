import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import type { AppConfig } from "./config.js";
import type { MicrosoftService } from "./microsoft.js";
import type { KeyService } from "./oauth/keys.js";
import type { OAuthService } from "./oauth/service.js";
import type { SessionService } from "./oauth/sessions.js";

const config = {
  environment: "test",
  issuer: "https://auth.example.test",
  cookieKeys: ["a".repeat(32)],
  microsoft: undefined,
} as AppConfig;

const app = createApp(
  config,
  {} as OAuthService,
  { publicJwks: { keys: [{ kty: "RSA", kid: "test" }] } } as KeyService,
  {} as SessionService,
  {} as MicrosoftService,
);

describe("protocol metadata", () => {
  it("publishes the configured /oauth endpoints", async () => {
    const response = await app.request("/.well-known/openid-configuration");
    expect(response.status).toBe(200);
    const metadata = await response.json();
    expect(metadata).toMatchObject({
      issuer: "https://auth.example.test",
      authorization_endpoint: "https://auth.example.test/oauth/authorize",
      token_endpoint: "https://auth.example.test/oauth/token",
      userinfo_endpoint: "https://auth.example.test/oauth/userinfo",
      jwks_uri: "https://auth.example.test/oauth/jwks",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
    });
  });

  it("publishes only public JWK material", async () => {
    const response = await app.request("/oauth/jwks");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ keys: [{ kty: "RSA", kid: "test" }] });
    expect(response.headers.get("cache-control")).toContain("max-age=300");
  });
});

describe("unexpected backend failures", () => {
  const brokenKeys = {} as KeyService;
  Object.defineProperty(brokenKeys, "publicJwks", {
    get() {
      throw new Error("test failure");
    },
  });
  const brokenApp = createApp(
    config,
    {} as OAuthService,
    brokenKeys,
    {} as SessionService,
    {} as MicrosoftService,
  );

  it("renders a safe HTML error page for browser navigations", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await brokenApp.request("/oauth/jwks", { headers: { Accept: "text/html" } });
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("Something went wrong");
    log.mockRestore();
  });

  it("keeps API failures as OAuth-style JSON", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await brokenApp.request("/oauth/jwks", { headers: { Accept: "application/json" } });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "server_error",
      error_description: "The request could not be completed",
    });
    log.mockRestore();
  });
});

describe("not-found responses", () => {
  it("renders a backend-owned HTML page for an unknown browser route", async () => {
    const response = await app.request("/missing", { headers: { Accept: "text/html" } });
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("Page not found");
  });

  it("returns JSON for an unknown API route", async () => {
    const response = await app.request("/oauth/missing", { headers: { Accept: "application/json" } });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "not_found",
      error_description: "The requested resource does not exist",
    });
  });
});
