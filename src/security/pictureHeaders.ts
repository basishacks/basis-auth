import type { Context } from "hono";

/**
 * Response headers for user-controlled image content (profile pictures,
 * application logos).
 *
 * The sandbox CSP makes browsers render the payload as an inert image even
 * when navigated to directly: scripts inside SVG (or HTML smuggled as an
 * image) can never execute on this origin. Content-Disposition forces a
 * download for top-level navigations while leaving <img> embedding working.
 */
export function applyImageResponseHeaders(c: Context, contentType: string, filename: string) {
  const safeFilename = filename.replace(/[^\w.-]/g, "_");
  c.header("Content-Type", contentType);
  c.header("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'");
  c.header("Content-Disposition", `attachment; filename="${safeFilename}"`);
  c.header("X-Content-Type-Options", "nosniff");
}
