import type { MiddlewareHandler } from "hono";
import { OAuthError } from "../oauth/errors.js";

interface WindowState {
  /** Index of the fixed window this state belongs to. */
  windowIndex: number;
  /** Requests counted in the previous window. */
  previous: number;
  /** Requests counted in the current window. */
  current: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  limit(key: string, now?: number): RateLimitDecision;
  /** Number of tracked keys; useful for operational checks and tests. */
  size(): number;
}

/**
 * Sliding-window counter rate limiter.
 *
 * Approximates a true sliding window with O(1) time and O(active keys) memory:
 * the request rate is estimated as the weighted sum of the previous and
 * current fixed windows. Accuracy is within one request of an exact sliding
 * window while never iterating stored events.
 *
 * ponytail: in-process Map, swap to Redis counters if this ever runs as more
 * than one instance behind the proxy.
 */
export function createRateLimiter(options: { windowMs: number; limit: number }): RateLimiter {
  const { windowMs, limit } = options;
  const buckets = new Map<string, WindowState>();
  let lastSweepAt = Number.NEGATIVE_INFINITY;

  function sweep(now: number) {
    // Lazy eviction keeps dead clients from accumulating without a timer.
    if (now - lastSweepAt < windowMs) return;
    lastSweepAt = now;
    const currentWindow = Math.floor(now / windowMs);
    for (const [key, state] of buckets) {
      if (currentWindow - state.windowIndex > 2) buckets.delete(key);
    }
  }

  return {
    limit(key: string, now: number = Date.now()): RateLimitDecision {
      sweep(now);
      const windowIndex = Math.floor(now / windowMs);
      let state = buckets.get(key);
      if (!state || state.windowIndex !== windowIndex) {
        state = {
          windowIndex,
          previous: state && windowIndex - state.windowIndex === 1 ? state.current : 0,
          current: 0,
        };
        buckets.set(key, state);
      }
      const elapsedRatio = (now % windowMs) / windowMs;
      const weightedCount = state.previous * (1 - elapsedRatio) + state.current;
      const remainingWindowMs = windowMs - (now % windowMs);
      if (weightedCount >= limit) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(remainingWindowMs / 1000)) };
      }
      state.current += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },
    size() {
      return buckets.size;
    },
  };
}

/**
 * Exponential backoff for repeated authentication failures.
 *
 * After `threshold` consecutive failures for a key, further attempts are
 * blocked for base * 2^(failures - threshold) milliseconds capped at maxMs.
 */
export function createFailureBackoff(options: { threshold: number; baseMs: number; maxMs: number }) {
  const failures = new Map<string, { count: number; blockedUntil: number }>();
  return {
    /** Returns the number of ms the key must still wait, or 0 when allowed. */
    check(key: string, now: number = Date.now()): number {
      const state = failures.get(key);
      if (!state) return 0;
      if (state.blockedUntil > now) return state.blockedUntil - now;
      return 0;
    },
    record(key: string, now: number = Date.now()) {
      const state = failures.get(key) ?? { count: 0, blockedUntil: 0 };
      state.count += 1;
      if (state.count >= options.threshold) {
        state.blockedUntil = now + Math.min(options.baseMs * 2 ** (state.count - options.threshold), options.maxMs);
      }
      failures.set(key, state);
    },
    reset(key: string) {
      failures.delete(key);
    },
  };
}

export function rateLimitMiddleware(limiter: RateLimiter, resolveKey: (c: any) => string): MiddlewareHandler {
  return async (c, next) => {
    const decision = limiter.limit(resolveKey(c));
    if (!decision.allowed) {
      c.header("Retry-After", String(decision.retryAfterSeconds));
      throw new OAuthError("rate_limited", "Too many requests. Please try again later.", 429, 1429);
    }
    await next();
  };
}
