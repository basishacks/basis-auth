import { getCookie } from "hono/cookie";
import type { Context, MiddlewareHandler } from "hono";
import type { AdminAuthService } from "./auth.js";
import { csrfValid, isLocked, type AdminContext, type AppEnv } from "./context.js";
import type { PortalPermission } from "./permissions.js";

export type { AppEnv };

/**
 * Optional perimeter filter. An empty allowlist disables the check entirely.
 * Entries may be exact IPs or IPv4 CIDR ranges such as 203.0.113.0/24.
 */
export function createIpAllowlistMiddleware(
  allowlist: readonly string[],
  resolveClientIp: (c: Context) => string,
): MiddlewareHandler {
  const parsedEntries = allowlist.map((entry) => parseCidr(entry)).filter(Boolean) as Cidr[];
  return async (c, next) => {
    if (parsedEntries.length === 0) return next();
    const ip = resolveClientIp(c);
    if (!ipMatches(ip, parsedEntries)) {
      return c.json({ error: "forbidden", error_description: "Address not permitted" }, 403);
    }
    await next();
  };
}

interface Cidr {
  address: string;
  prefixBits: number;
  family: 4 | 6;
}

function parseCidr(entry: string): Cidr | undefined {
  const separator = entry.indexOf("/");
  const address = separator === -1 ? entry : entry.slice(0, separator);
  const prefixBits = separator === -1 ? undefined : Number(entry.slice(separator + 1));
  const family = address.includes(":") ? 6 : 4;
  if (family === 4 && !/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) return undefined;
  return {
    address: address.toLowerCase(),
    prefixBits: prefixBits ?? (family === 4 ? 32 : 128),
    family,
  };
}

function ipv4ToInt(address: string): number | undefined {
  const parts = address.split(".");
  if (parts.length !== 4) return undefined;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return undefined;
    value = value * 256 + octet;
  }
  return value;
}

function ipMatches(ip: string, entries: Cidr[]): boolean {
  const normalized = ip.toLowerCase();
  for (const entry of entries) {
    if (entry.family === 4 && !normalized.includes(":")) {
      const candidate = ipv4ToInt(normalized);
      const network = ipv4ToInt(entry.address);
      if (candidate === undefined || network === undefined) continue;
      const mask = entry.prefixBits === 0 ? 0 : (0xffffffff << (32 - entry.prefixBits)) >>> 0;
      if ((candidate & mask) === (network & mask)) return true;
    } else if (normalized === entry.address) {
      // Non-IPv4 entries fall back to exact matching.
      return true;
    }
  }
  return false;
}

/** Global break-glass switch: blocks every portal route except the health probe. */
export function createLockoutMiddleware(db: Parameters<typeof isLocked>[0]): MiddlewareHandler {
  return async (c, next) => {
    if (await isLocked(db)) {
      return c.json(
        { error: "portal_locked", error_description: "The portal is locked. Contact an administrator." },
        503,
      );
    }
    await next();
  };
}

export function requireSession(
  authService: AdminAuthService,
  sessionCookieName: string,
): MiddlewareHandler {
  return async (c, next) => {
    const admin = await authService.validateSession(getCookie(c, sessionCookieName));
    if (!admin) return c.json({ error: "unauthorized" }, 401);
    c.set("admin", admin);
    await next();
  };
}

/** Deny-by-default permission gate; every listed permission is required. */
export function requirePermissions(...needed: readonly PortalPermission[]): MiddlewareHandler {
  return async (c, next) => {
    const admin = c.get("admin");
    const missing = needed.filter((permission) => !admin.permissions.has(permission));
    if (missing.length > 0) {
      return c.json({ error: "forbidden", error_description: "Insufficient portal permissions" }, 403);
    }
    await next();
  };
}

export function requireStepUp(maxAgeSeconds: number): MiddlewareHandler {
  return async (c, next) => {
    const admin = c.get("admin");
    const ageSeconds = (Date.now() - admin.authTime.getTime()) / 1000;
    if (ageSeconds > maxAgeSeconds) {
      return c.json({ error: "step_up_required", maxAgeSeconds }, 401);
    }
    await next();
  };
}

export function requireCsrf(cookieSecret: string): MiddlewareHandler {
  return async (c, next) => {
    const admin = c.get("admin");
    if (!csrfValid(cookieSecret, admin.sessionIdHash, c.req.header("x-csrf-token"))) {
      return c.json({ error: "invalid_csrf_token" }, 403);
    }
    await next();
  };
}
