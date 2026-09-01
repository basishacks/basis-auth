import { describe, expect, it } from "vitest";
import { resolveEmailVerified } from "./microsoft.js";

describe("resolveEmailVerified", () => {
  it("trusts an explicit email_verified flag from the userinfo response", () => {
    expect(resolveEmailVerified({ email_verified: true }, {})).toBe(true);
  });

  it("trusts the email_verified flag carried in the id_token claims", () => {
    expect(resolveEmailVerified({}, { email_verified: true })).toBe(true);
  });

  it("treats an explicit false flag as unverified", () => {
    expect(resolveEmailVerified({ email_verified: false }, {})).toBe(false);
  });

  it("does not invent verification when no flag is present", () => {
    expect(resolveEmailVerified({ mail: "user@example.test" }, { email: "user@example.test" })).toBe(false);
  });

  it("treats an absent userInfo as unverified", () => {
    expect(resolveEmailVerified(undefined, {})).toBe(false);
  });
});
