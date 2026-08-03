import { describe, expect, it } from "vitest";
import {
  hashToken,
  isValidPkceVerifier,
  isValidS256Challenge,
  isValidS256PkceRequest,
  pkceChallenge,
  randomToken,
  verifyS256Pkce,
} from "./crypto.js";

describe("OAuth cryptographic helpers", () => {
  it("produces URL-safe random values and deterministic hashes", () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toBe(token);
  });

  it("implements the RFC 7636 S256 test vector", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    expect(pkceChallenge(verifier)).toBe(challenge);
    expect(verifyS256Pkce(verifier, challenge)).toBe(true);
    expect(verifyS256Pkce(`${verifier}x`, challenge)).toBe(false);
  });

  it("enforces the RFC 7636 verifier and S256 challenge syntax", () => {
    expect(isValidPkceVerifier("a".repeat(43))).toBe(true);
    expect(isValidPkceVerifier("a".repeat(128))).toBe(true);
    expect(isValidPkceVerifier("a".repeat(42))).toBe(false);
    expect(isValidPkceVerifier("a".repeat(129))).toBe(false);
    expect(isValidPkceVerifier(`${"a".repeat(42)}!`)).toBe(false);
    expect(isValidS256Challenge("a".repeat(43))).toBe(true);
    expect(isValidS256Challenge("a".repeat(42))).toBe(false);
    expect(isValidS256Challenge(`${"a".repeat(42)}~`)).toBe(false);
  });

  it("does not allow nonce or the plain method to replace S256 PKCE", () => {
    const challenge = "a".repeat(43);
    expect(isValidS256PkceRequest(undefined, undefined)).toBe(false);
    expect(isValidS256PkceRequest(challenge, "plain")).toBe(false);
    expect(isValidS256PkceRequest(challenge, "S256")).toBe(true);
  });
});
