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

  it("treats an empty granted set as covering only an empty request", () => {
    expect(scopesCover([], [])).toBe(true);
    expect(scopesCover([], ["user.write.email"])).toBe(false);
  });

  it("covers many requested scopes in a single pass without nested scans", () => {
    const granted = ["user.write.all", "projects.read"];
    const required = ["user.write.email", "user.write.picture", "projects.read"];
    expect(scopesCover(granted, required)).toBe(true);
    expect(scopesCover(["user.write.all"], ["projects.read"])).toBe(false);
  });

  it("supports multiple .all prefixes", () => {
    expect(scopesCover(["a.all", "b.all"], ["a.x", "b.y"])).toBe(true);
    expect(scopesCover(["a.all"], ["b.y"])).toBe(false);
  });
});

describe("scopesCover — doubled battery", () => {
  it("does not treat a partial prefix match as coverage", () => {
    expect(scopesCover(["user.write"], ["user.write.email"])).toBe(false);
    expect(scopesCover(["user"], ["user.write.email"])).toBe(false);
  });

  it("ignores duplicate granted scopes without changing the result", () => {
    expect(scopesCover(["user.write.all", "user.write.all"], ["user.write.email"])).toBe(true);
  });

  it("requires every element of a multi-scope request to be covered", () => {
    expect(scopesCover(["user.write.all"], ["user.write.email", "projects.read"])).toBe(false);
    expect(scopesCover(["user.write.all", "projects.read"], ["user.write.email", "projects.read"])).toBe(true);
  });

  it("treats an empty required list as always covered", () => {
    expect(scopesCover([], [])).toBe(true);
    expect(scopesCover(["user.write.all"], [])).toBe(true);
  });

  it("matches exact scope equality in addition to prefix coverage", () => {
    expect(scopesCover(["openid"], ["openid"])).toBe(true);
    expect(scopesCover(["openid"], ["openid", "profile"])).toBe(false);
  });

  it("does not let one .all claim cover an unrelated root", () => {
    expect(scopesCover(["a.all"], ["b.x"])).toBe(false);
    expect(scopesCover(["a.all", "b.all"], ["b.x"])).toBe(true);
  });
});
