import { describe, expect, it } from "vitest";
import { scopeGrants, scopesCover } from "./scopes.js";

describe("delegated scope hierarchy", () => {
  it("allows exact scopes", () => {
    expect(scopeGrants("user.write.email", "user.write.email")).toBe(true);
  });

  it("allows descendants only through an explicit all scope", () => {
    expect(scopeGrants("user.write.all", "user.write.email")).toBe(true);
    expect(scopeGrants("user.all", "user.write.email")).toBe(true);
    expect(scopeGrants("user.write", "user.write.email")).toBe(false);
    expect(scopeGrants("user.write.email", "user.write.all")).toBe(false);
  });

  it("requires coverage for every requested scope", () => {
    expect(
      scopesCover(["user.write.email", "user.write.picture"], ["user.write.email", "user.write.picture"]),
    ).toBe(true);
    expect(scopesCover(["user.write.email"], ["user.write.email", "user.write.picture"])).toBe(false);
  });
});
