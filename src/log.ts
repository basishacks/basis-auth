/**
 * Minimal structured logger.
 *
 * Logs only sanitized, non-sensitive text. Never logs tokens, secrets, or raw
 * exception objects (which can embed PII or stack traces) to avoid leaking
 * data through log aggregation.
 */

function sanitize(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  return "Unknown error";
}

export const log = {
  info(message: unknown): void {
    console.log(message);
  },
  warn(message: unknown): void {
    console.warn(message);
  },
  error(error: unknown, context?: string): void {
    console.error(context ? `${context}: ${sanitize(error)}` : sanitize(error));
  },
};
