import { describe, expect, it } from "vitest";
import { generateTempPassword, hashPassword, validatePassword, verifyPassword } from "./passwords.js";

describe("NIST password policy", () => {
  it("requires at least twelve characters", () => {
    expect(validatePassword("short1!a").valid).toBe(false);
    expect(validatePassword("long-enough-123").valid).toBe(true);
  });

  it("rejects commonly used secrets regardless of length", () => {
    expect(validatePassword("password123456").valid).toBe(false);
  });

  it("blocks email local part and display name substrings", () => {
    const context = { email: "richie@example.test", displayName: "Richie" };
    expect(validatePassword("richie-password", context).valid).toBe(false);
    expect(validatePassword("other-value-rich", context).valid).toBe(true);
  });
});

describe("password hashing", () => {
  it("round-trips through the scrypt encoded form without storing plaintext", async () => {
    const encoded = await hashPassword("correct horse battery staple");
    expect(encoded.startsWith("scrypt:")).toBe(true);
    expect(await verifyPassword("correct horse battery staple", encoded)).toBe(true);
    expect(await verifyPassword("wrong horse battery staple", encoded)).toBe(false);
    expect(await verifyPassword("x", null)).toBe(false);
  });

  it("generates twenty-character temporary passwords from a safe alphabet", () => {
    const password = generateTempPassword();
    expect(password).toHaveLength(20);
    expect(validatePassword(password).valid).toBe(true);
  });
});
