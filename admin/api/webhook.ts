import { createHmac, timingSafeEqual } from "node:crypto";

export interface AlertPayload {
  event: string;
  actor: string | null;
  targetType: string;
  targetId: string;
  detail?: Record<string, unknown>;
}

/**
 * Delivers a privilege-change alert to the configured webhook.
 *
 * The raw JSON body is signed with HMAC-SHA256 under x-basis-signature so the
 * receiver can verify authenticity. Delivery is best-effort: failures are
 * logged but never block or fail the audited operation itself.
 */
export function sendWebhookAlert(
  url: string,
  secret: string,
  payload: AlertPayload,
): void {
  const body = JSON.stringify({ ts: new Date().toISOString(), ...payload });
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  void fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-basis-signature": `sha256=${signature}`,
    },
    body,
    signal: AbortSignal.timeout(5_000),
  }).catch((error) => {
    console.error("Alert webhook delivery failed", error);
  });
}

/** Constant-time comparison of a delivered signature against the expected one. */
export function verifyWebhookSignature(secret: string, body: string, supplied: string): boolean {
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
