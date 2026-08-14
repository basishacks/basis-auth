import { decodeJwt, exportJWK, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config.js";
import type { IdentityService } from "../identity.js";
import { createKeyService } from "./keys.js";

describe("ID token claims", () => {
  it("uses the public profile-picture endpoint for the standard picture claim", async () => {
    const { privateKey } = await generateKeyPair("RS256", { extractable: true });
    const jwk = await exportJWK(privateKey);
    jwk.kid = "test";
    const config = {
      issuer: "https://auth.example.test",
      jwks: { keys: [jwk] },
    } as AppConfig;
    const identity = {
      findAccount: async () => ({
        accountId: "d2c3f635-527c-4c0a-bc1c-15d6af3f0946",
        claims: async () => ({ sub: "d2c3f635-527c-4c0a-bc1c-15d6af3f0946" }),
      }),
    } as unknown as IdentityService;
    const keys = await createKeyService(config, identity);

    const token = await keys.issueIdToken({
      userId: "d2c3f635-527c-4c0a-bc1c-15d6af3f0946",
      clientId: "client",
      scopes: ["openid", "profile"],
      nonce: "nonce",
      authenticatedAt: new Date(),
      accessToken: "access-token",
    });

    expect(decodeJwt(token).picture).toBe(
      "https://auth.example.test/api/picture/d2c3f635-527c-4c0a-bc1c-15d6af3f0946",
    );
  });
});
