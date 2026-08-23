import { describe, expect, it, vi } from "vitest";
import { createFailureBackoff, createRateLimiter, rateLimitMiddleware } from "./rateLimit.js";
import { OAuthError } from "../oauth/errors.js";

describe("sliding-window rate limiter", () => {
  it("allows requests under the limit and blocks beyond it", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, limit: 3 });
    const now = 1_700_000_000_000;
    expect(limiter.limit("client-a", now).allowed).toBe(true);
    expect(limiter.limit("client-a", now + 1).allowed).toBe(true);
    expect(limiter.limit("client-a", now + 2).allowed).toBe(true);
    const blocked = limiter.limit("client-a", now + 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    // Other keys are unaffected.
    expect(limiter.limit("client-b", now + 4).allowed).toBe(true);
  });

  it("carries weighted history across window boundaries without bursts", () => {
    const windowMs = 10_000;
    const limiter = createRateLimiter({ windowMs, limit: 2 });
    const start = 1_700_000_000_000;
    // Exhaust the first window.
    limiter.limit("key", start);
    limiter.limit("key", start);
    // Just past the boundary the previous window still dominates the estimate.
    const nearBoundary = start + windowMs - 1;
    expect(limiter.limit("key", nearBoundary).allowed).toBe(false);
  });

  it("evicts stale keys so memory stays bounded", () => {
    const limiter = createRateLimiter({ windowMs: 1_000, limit: 1 });
    limiter.limit("old-key", 1_000);
    limiter.limit("new-key", 1_000 + 5 * 1_000);
    expect(limiter.size()).toBe(1);
  });
});

describe("failure backoff", () => {
  it("blocks only after the threshold and grows exponentially with a cap", () => {
    vi.useFakeTimers();
    try {
      const backoff = createFailureBackoff({ threshold: 3, baseMs: 1_000, maxMs: 8_000 });
      const now = Date.now();
      expect(backoff.check("k", now)).toBe(0);
      backoff.record("k", now);
      backoff.record("k", now);
      expect(backoff.check("k", now)).toBe(0);
      backoff.record("k", now);
      expect(backoff.check("k", now)).toBe(1_000);
      for (let i = 0; i < 5; i += 1) backoff.record("k", now);
      expect(backoff.check("k", now)).toBe(8_000);
      backoff.reset("k");
      expect(backoff.check("k", now)).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("rate limit middleware", () => {
  it("rejects with a 429 and a Retry-After header", async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, limit: 0 });
    const middleware = rateLimitMiddleware(limiter, () => "ip");
    const headers = new Headers();
    let nextCalled = false;
    await expect(
      middleware(
        {
          req: { header: () => undefined },
          header: (name: string, value: string) => headers.set(name, value),
        },
        async () => {
          nextCalled = true;
        },
      ) as Promise<void>,
    ).rejects.toThrow(OAuthError);
    expect(nextCalled).toBe(false);
    const retryAfter = Number(headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });
});
