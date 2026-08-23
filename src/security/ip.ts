import type { Context } from "hono";

/**
 * Resolves the originating client IP for a request.
 *
 * When the deployment sits behind a trusted reverse proxy (TRUST_PROXY=true),
 * the left-most X-Forwarded-For entry is used. Otherwise proxy headers are
 * ignored entirely so clients cannot spoof their address, and the direct
 * socket peer is returned instead.
 */
export function createClientIpResolver(trustProxy: boolean) {
  return function resolveClientIp(c: Context): string {
    if (trustProxy) {
      const forwarded = c.req.header("x-forwarded-for");
      const candidate = forwarded?.split(",")[0]?.trim();
      if (candidate) return normalizeIp(candidate);
    }
    const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
    const socketAddress = incoming?.socket?.remoteAddress;
    if (socketAddress) return normalizeIp(socketAddress);
    return "unknown";
  };
}

function normalizeIp(value: string): string {
  const trimmed = value.trim();
  // Strip the ::ffff: IPv4-mapped IPv6 prefix that Node reports for IPv4 peers.
  return trimmed.startsWith("::ffff:") ? trimmed.slice(7) : trimmed;
}
