import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const S256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

export function pkceChallenge(verifier: string) {
  return hashToken(verifier);
}

export function isValidPkceVerifier(value: string) {
  return PKCE_VERIFIER.test(value);
}

export function isValidS256Challenge(value: string) {
  return S256_CHALLENGE.test(value);
}

export function isValidS256PkceRequest(challenge?: string, method?: string) {
  return method === "S256" && typeof challenge === "string" && isValidS256Challenge(challenge);
}

export function verifyS256Pkce(verifier: string, expectedChallenge: string) {
  if (!isValidPkceVerifier(verifier) || !isValidS256Challenge(expectedChallenge)) return false;
  const actual = Buffer.from(pkceChallenge(verifier));
  const expected = Buffer.from(expectedChallenge);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
