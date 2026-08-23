import { describe, expect, it } from "vitest";
import { decodeBase32, encodeBase32, generateTotp, otpauthUri, verifyTotp } from "./totp.js";

describe("base32", () => {
  it("round-trips arbitrary bytes", () => {
    const input = Buffer.from([0, 1, 2, 250, 251, 252, 77]);
    expect(decodeBase32(encodeBase32(input)).equals(input)).toBe(true);
  });
});

describe("TOTP", () => {
  const secret = Buffer.from("0123456789abcdef0123456789abcdef");

  it("accepts the current code and rejects tampered codes", () => {
    const at = 1_700_000_000_000;
    const code = generateTotp(secret, 30, at);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotp(secret, code, at)).toBe(true);
    expect(verifyTotp(secret, "000000", at)).toBe(code === "000000");
  });

  it("absorbs one step of clock drift in either direction", () => {
    const at = 1_700_000_123_456;
    const previous = generateTotp(secret, 30, at - 30_000);
    const next = generateTotp(secret, 30, at + 30_000);
    expect(verifyTotp(secret, previous, at)).toBe(true);
    expect(verifyTotp(secret, next, at)).toBe(true);
  });

  it("rejects codes outside the drift window and malformed input", () => {
    const at = 1_700_000_000_000;
    const farPast = generateTotp(secret, 30, at - 5 * 30_000);
    expect(verifyTotp(secret, farPast, at)).toBe(false);
    expect(verifyTotp(secret, "abcdef", at)).toBe(false);
    expect(verifyTotp(secret, "12345", at)).toBe(false);
  });

  it("builds a valid otpauth enrollment URI", () => {
    const uri = otpauthUri("JBSWY3DPEHPK3PXP", "admin@example.test", "Basis Admin");
    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(uri).toContain(encodeURIComponent("Basis Admin"));
  });
});
