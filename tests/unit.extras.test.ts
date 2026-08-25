import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashToken, isValidPkceVerifier, isValidS256Challenge, pkceChallenge, randomToken, verifyS256Pkce } from "../src/oauth/crypto.js";
import { scopesCover } from "../src/oauth/scopes.js";
import { verifyWebhookSignature } from "../admin/api/webhook.js";
import { isPortalPermission, PORTAL_PERMISSIONS } from "../admin/api/permissions.js";
import { validatePassword, generateTempPassword } from "../admin/api/passwords.js";

describe("PKCE primitives", () => {
  const verifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
  it("accepts RFC 7636 character range verifiers", () => {
    expect(isValidPkceVerifier(verifier)).toBe(true);
  });
  it("rejects undersized and oversized verifiers", () => {
    expect(isValidPkceVerifier("short")).toBe(false);
    expect(isValidPkceVerifier("a".repeat(129))).toBe(false);
  });
  it("rejects malformed S256 challenges", () => {
    expect(isValidS256Challenge("too-short")).toBe(false);
    expect(isValidS256Challenge("a".repeat(43))).toBe(true);
  });
  it("verifies matching challenges and rejects mismatches", () => {
    expect(verifyS256Pkce(verifier, pkceChallenge(verifier))).toBe(true);
    expect(verifyS256Pkce(verifier, pkceChallenge(verifier + "x"))).toBe(false);
  });
  it("hashes tokens as deterministic base64url sha256", () => {
    expect(hashToken("value")).toBe(hashToken("value"));
    expect(hashToken("value")).toBe(createHash("sha256").update("value").digest("base64url"));
    expect(hashToken("value")).not.toBe(hashToken("other"));
  });
  it("generates url-safe random tokens", () => {
    const token = randomToken(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThan(30);
  });
});

describe("scope algebra", () => {
  it("covers nested children beneath wildcard roots", () => {
    expect(scopesCover(["api.all"], ["api.users.read"])).toBe(true);
    expect(scopesCover(["api.all"], ["apis.users.read"])).toBe(false);
  });
  it("never grants across similarly prefixed roots", () => {
    expect(scopesCover(["user.all"], ["users.read"])).toBe(false);
  });
});

describe("webhook signatures", () => {
  const secret = "s".repeat(40);
  const body = JSON.stringify({ ts: "2026-01-01T00:00:00Z", event: "portal.user.permissions.replaced" });
  const sign = (payload: string) => "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
  it("verifies correctly signed payloads", () => {
    expect(verifyWebhookSignature(secret, body, sign(body))).toBe(true);
  });
  it("rejects tampered payloads and wrong secrets", () => {
    expect(verifyWebhookSignature(secret, body + " ", sign(body))).toBe(false);
    expect(verifyWebhookSignature("z".repeat(40), body, sign(body))).toBe(false);
  });
});

describe("permission catalog integrity", () => {
  it("contains unique portal-prefixed entries", () => {
    expect(new Set(PORTAL_PERMISSIONS).size).toBe(PORTAL_PERMISSIONS.length);
    for (const permission of PORTAL_PERMISSIONS) {
      expect(permission.startsWith("portal.")).toBe(true);
    }
  });
  it("classifies known and unknown values fail-closed", () => {
    expect(isPortalPermission("portal.audit.read")).toBe(true);
    expect(isPortalPermission("admin")).toBe(false);
    expect(isPortalPermission("portal.madeup")).toBe(false);
  });
});

describe("password policy boundaries", () => {
  it("accepts exactly twelve characters", () => {
    expect(validatePassword("abcdef123456").valid).toBe(true);
  });
  it("caps maximum length at two hundred characters", () => {
    expect(validatePassword("a".repeat(200)).valid).toBe(true);
    expect(validatePassword("a".repeat(201)).valid).toBe(false);
  });
  it("applies the deny list case-insensitively", () => {
    expect(validatePassword("PASSWORD12345").valid).toBe(false);
  });
  it("produces distinct temporary passwords", () => {
    const seen = new Set(Array.from({ length: 25 }, () => generateTempPassword()));
    expect(seen.size).toBe(25);
  });
});




