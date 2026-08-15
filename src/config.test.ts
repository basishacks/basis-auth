import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const base = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@localhost/test",
  INTERNAL_API_TOKEN: "a".repeat(32),
  OIDC_ISSUER: "https://auth.example.test/",
  OIDC_COOKIE_KEYS: "a".repeat(32),
  OIDC_RESOURCES_JSON: JSON.stringify([
    { audience: "urn:basis:api:test", scopes: ["records.read"] },
  ]),
  OIDC_CLIENTS_JSON: JSON.stringify([
    {
      clientId: "test-client",
      clientSecret: "a-sufficiently-long-secret",
      redirectUris: ["https://client.example.test/callback"],
      scopes: ["openid", "records.read"],
      resources: ["urn:basis:api:test"],
    },
  ]),
};

describe("configuration", () => {
  it("normalizes the issuer and validates client resources", async () => {
    const config = await loadConfig(base);
    expect(config.issuer).toBe("https://auth.example.test");
    expect(config.clients[0]?.clientId).toBe("test-client");
    expect(config.jwks.keys[0]?.d).toBeTypeOf("string");
  });

  it("rejects clients referencing an unknown resource", async () => {
    await expect(
      loadConfig({
        ...base,
        OIDC_CLIENTS_JSON: JSON.stringify([
          {
            clientId: "bad-client",
            clientSecret: "a-sufficiently-long-secret",
            redirectUris: ["https://client.example.test/callback"],
            scopes: ["openid"],
            resources: ["urn:basis:api:missing"],
          },
        ]),
      }),
    ).rejects.toThrow("unknown resource");
  });

  it("rejects incomplete Microsoft configuration", async () => {
    await expect(loadConfig({ ...base, MICROSOFT_CLIENT_ID: "client" })).rejects.toThrow(
      "must be set together",
    );
  });

  it("requires a filter mode when a client has filter content", async () => {
    await expect(
      loadConfig({
        ...base,
        OIDC_CLIENTS_JSON: JSON.stringify([
          {
            clientId: "filtered-client",
            clientSecret: "a-sufficiently-long-secret",
            redirectUris: ["https://client.example.test/callback"],
            scopes: ["openid"],
            resources: ["urn:basis:api:test"],
            filterContent: ["student@example.test"],
          },
        ]),
      }),
    ).rejects.toThrow("requires filterMode");
  });
});
