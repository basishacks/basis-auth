import { describe, expect, it, vi } from "vitest";
import { log } from "./log.js";

describe("log", () => {
  it("logs info through console.log", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    log.info("hello");
    expect(spy).toHaveBeenCalledWith("hello");
    spy.mockRestore();
  });

  it("logs warnings through console.warn", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    log.warn("careful");
    expect(spy).toHaveBeenCalledWith("careful");
    spy.mockRestore();
  });

  it("logs only the Error message, never the stack or object", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Error("boom");
    log.error(error);
    expect(spy).toHaveBeenCalledWith("boom");
    spy.mockRestore();
  });

  it("logs a plain string as-is", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    log.error("plain failure");
    expect(spy).toHaveBeenCalledWith("plain failure");
    spy.mockRestore();
  });

  it("falls back to a generic message for unknown values", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    log.error(undefined);
    expect(spy).toHaveBeenCalledWith("Unknown error");
    spy.mockRestore();
  });

  it("prefixes a context label when provided", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    log.error(new Error("x"), "request");
    expect(spy).toHaveBeenCalledWith("request: x");
    spy.mockRestore();
  });
});

describe("log — doubled battery", () => {
  it("logs an object through console.log without leaking secrets", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    log.info({ event: "login", userId: "abc" });
    expect(spy).toHaveBeenCalledWith({ event: "login", userId: "abc" });
    spy.mockRestore();
  });

  it("logs numeric warnings", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    log.warn(42);
    expect(spy).toHaveBeenCalledWith(42);
    spy.mockRestore();
  });

  it("logs an Error alongside a context object label", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    log.error(new Error("boom"), "token-issuance");
    expect(spy).toHaveBeenCalledWith("token-issuance: boom");
    spy.mockRestore();
  });

  it("logs a plain string alongside a context label", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    log.error("db unreachable", "database");
    expect(spy).toHaveBeenCalledWith("database: db unreachable");
    spy.mockRestore();
  });

  it("treats an empty string error as a plain message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    log.error("");
    expect(spy).toHaveBeenCalledWith("");
    spy.mockRestore();
  });

  it("treats null as an unknown error even with a context label", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    log.error(null, "ctx");
    expect(spy).toHaveBeenCalledWith("ctx: Unknown error");
    spy.mockRestore();
  });
});
