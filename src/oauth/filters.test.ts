import { describe, expect, it } from "vitest";
import { assertClientEmailAccess } from "./service.js";
import { OAuthError } from "./errors.js";

describe("client email filters", () => {
  it("admits any address when no filter mode is configured", () => {
    expect(() =>
      assertClientEmailAccess({ filterMode: null, filterContent: [] }, "anyone@example.test"),
    ).not.toThrow();
  });

  it("blocks addresses missing from a whitelist", () => {
    expect(() =>
      assertClientEmailAccess(
        { filterMode: "whitelist", filterContent: ["allowed@example.test"] },
        "blocked@example.test",
      ),
    ).toThrow(OAuthError);
  });

  it("admits whitelisted addresses regardless of case or padding", () => {
    expect(() =>
      assertClientEmailAccess(
        { filterMode: "whitelist", filterContent: ["allowed@example.test"] },
        "  Allowed@Example.Test ",
      ),
    ).not.toThrow();
  });

  it("blocks blacklisted addresses and admits everyone else", () => {
    expect(() =>
      assertClientEmailAccess(
        { filterMode: "blacklist", filterContent: ["blocked@example.test"] },
        "blocked@example.test",
      ),
    ).toThrow(OAuthError);
    expect(() =>
      assertClientEmailAccess(
        { filterMode: "blacklist", filterContent: ["blocked@example.test"] },
        "other@example.test",
      ),
    ).not.toThrow();
  });
});
