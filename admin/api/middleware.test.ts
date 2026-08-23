import { describe, expect, it, vi } from "vitest";
import type { Context } from "hono";
import {
  createIpAllowlistMiddleware,
  requirePermissions,
  requireStepUp,
} from "./middleware.js";
import type { AdminContext } from "./context.js";

function stubContext(headers: Record<string, string> = {}): Context & { headers: Headers; vars: Map<string, unknown> } {
  const store = new Headers(headers);
  const vars = new Map<string, unknown>();
  const c = {
    req: { header: (name: string) => store.get(name) },
    header: (name: string, value: string) => store.set(name, value),
    get: (key: string) => vars.get(key),
    set: (key: string, value: unknown) => void vars.set(key, value),
    json: vi.fn(async () => new Response(null)),
  };
  return Object.assign(c as unknown as Context, { headers: store, vars });
}

describe("IP allowlist", () => {
  const makeNext = () => vi.fn(async () => undefined);

  it("passes everything when no entries are configured", async () => {
    const middleware = createIpAllowlistMiddleware([], () => "10.0.0.1");
    const next = makeNext();
    await middleware(stubContext(), next);
    expect(next).toHaveBeenCalled();
  });

  it("admits addresses inside an IPv4 range and rejects the rest", async () => {
    const middleware = createIpAllowlistMiddleware(["203.0.113.0/24"], (c) =>
      c.req.header("x-test-ip")!,
    );
    const allowed = makeNext();
    await middleware(stubContext({ "x-test-ip": "203.0.113.7" }), allowed);
    expect(allowed).toHaveBeenCalledTimes(1);
    const blocked = makeNext();
    await middleware(stubContext({ "x-test-ip": "203.0.114.7" }), blocked);
    expect(blocked).not.toHaveBeenCalled();
  });

  it("matches exact IPv6 entries literally", async () => {
    const middleware = createIpAllowlistMiddleware(["2001:db8::1"], (c) => c.req.header("x-test-ip")!);
    const allowed = makeNext();
    await middleware(stubContext({ "x-test-ip": "2001:db8::1" }), allowed);
    expect(allowed).toHaveBeenCalledTimes(1);
    const blocked = makeNext();
    await middleware(stubContext({ "x-test-ip": "2001:db8::2" }), blocked);
    expect(blocked).not.toHaveBeenCalled();
  });
});

describe("permission gate", () => {
  const admin: AdminContext = {
    sessionIdHash: "hash",
    userId: "user",
    email: "admin@example.test",
    permissions: new Set(["portal.users.read"]),
    authTime: new Date(),
  };

  it("allows when every required permission is held", async () => {
    const middleware = requirePermissions("portal.users.read");
    const c = stubContext();
    c.set("admin", admin);
    const next = vi.fn(async () => undefined);
    await middleware(c, next);
    expect(next).toHaveBeenCalled();
  });

  it("denies when any required permission is missing", async () => {
    const middleware = requirePermissions("portal.users.read", "portal.users.write");
    const c = stubContext();
    c.set("admin", admin);
    const next = vi.fn(async () => undefined);
    await middleware(c, next);
    expect(next).not.toHaveBeenCalled();
    expect((c.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toBe(403);
  });
});

describe("step-up freshness", () => {
  it("rejects stale authentications with a step-up challenge", async () => {
    const middleware = requireStepUp(300);
    const c = stubContext();
    c.set("admin", {
      sessionIdHash: "hash",
      userId: "user",
      email: "admin@example.test",
      permissions: new Set(),
      authTime: new Date(Date.now() - 10 * 60_000),
    } satisfies AdminContext);
    const next = vi.fn(async () => undefined);
    await middleware(c, next);
    expect(next).not.toHaveBeenCalled();
    const payload = (c.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(payload.error).toBe("step_up_required");
  });

  it("accepts fresh authentications", async () => {
    const middleware = requireStepUp(300);
    const c = stubContext();
    c.set("admin", {
      sessionIdHash: "hash",
      userId: "user",
      email: "admin@example.test",
      permissions: new Set(),
      authTime: new Date(),
    } satisfies AdminContext);
    const next = vi.fn(async () => undefined);
    await middleware(c, next);
    expect(next).toHaveBeenCalled();
  });
});
