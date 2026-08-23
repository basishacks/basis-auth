import { promisify } from "node:util";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

const scrypt = promisify(scryptCallback);

// NIST SP 800-63B style policy: length first, block-listed secrets, no
// forced composition rules. The deny list covers the most common leaked
// passwords so trivially guessable credentials are refused at creation.
const MIN_LENGTH = 12;
const MAX_LENGTH = 200;
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password12", "password123", "password1234", "password12345",
  "password123456", "password1234567", "123456789012",
  "qwertyuiopas", "letmeinnow", "welcome12345", "iloveyou1234", "adminadmin123",
  "aaaaaaaaaaaaa", "abcdefghijkl", "abcd1234efgh", "qazwsxedcrfvtgb", "passw0rdpass",
  "changeme12345", "masterchief12", "sunshine12345", "princess12345", "football12345",
]);

export interface PasswordCheck {
  valid: boolean;
  reason?: string;
}

export function validatePassword(
  password: string,
  context: { email?: string; displayName?: string } = {},
): PasswordCheck {
  if (typeof password !== "string" || password.length < MIN_LENGTH) {
    return { valid: false, reason: `Password must be at least ${MIN_LENGTH} characters` };
  }
  if (password.length > MAX_LENGTH) {
    return { valid: false, reason: `Password must be at most ${MAX_LENGTH} characters` };
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { valid: false, reason: "This password appears on a commonly used list" };
  }
  const localPart = context.email?.split("@")[0]?.toLowerCase();
  if (localPart && localPart.length >= 3 && password.toLowerCase().includes(localPart)) {
    return { valid: false, reason: "Password must not contain your email name" };
  }
  const name = context.displayName?.toLowerCase();
  if (name && name.length >= 3 && password.toLowerCase().includes(name)) {
    return { valid: false, reason: "Password must not contain your display name" };
  }
  return { valid: true };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const digest = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("base64url")}:${digest.toString("base64url")}`;
}

export async function verifyPassword(
  password: string,
  encoded: string | null | undefined,
): Promise<boolean> {
  if (!encoded) return false;
  const [algorithm, saltValue, digestValue] = encoded.split(":");
  if (algorithm !== "scrypt" || !saltValue || !digestValue) return false;
  const expected = Buffer.from(digestValue, "base64url");
  const actual = (await scrypt(password, Buffer.from(saltValue, "base64url"), expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Generates a readable temporary password shown exactly once at provisioning. */
export function generateTempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
  const bytes = randomBytes(20);
  let output = "";
  for (const byte of bytes) output += alphabet[byte % alphabet.length];
  return output;
}
