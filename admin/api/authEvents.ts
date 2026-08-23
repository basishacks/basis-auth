import { sql } from "drizzle-orm";
import type { Database } from "../../src/database/client.js";

export type AuthEventKind =
  | "sign_in"
  | "sign_in_failure"
  | "token_issued"
  | "token_refreshed"
  | "token_refresh_rejected"
  | "logout";

export interface AuthEvent {
  userId?: string | null;
  kind: AuthEventKind;
  provider?: string | null;
  clientId?: string | null;
  success?: boolean;
  ip?: string | null;
  userAgent?: string | null;
  detail?: Record<string, unknown>;
}

/**
 * Appends a sign-in activity record. The sign-in log is best-effort by
 * design: failures are logged and swallowed so telemetry can never break
 * an authentication flow. Audit events (administrator actions) are the
 * durable, synchronous channel.
 */
export function createAuthEventWriter(db: Database) {
  return async function recordAuthEvent(event: AuthEvent): Promise<void> {
    try {
      await db.execute(sql`
        insert into auth_events (user_id, kind, provider, client_id, success, ip, user_agent, detail)
        values (
          ${event.userId ?? null},
          ${event.kind},
          ${event.provider ?? null},
          ${event.clientId ?? null},
          ${event.success ?? true},
          ${event.ip ?? null},
          ${event.userAgent ?? null},
          ${JSON.stringify(event.detail ?? {}) as unknown}::jsonb
        )
      `);
    } catch (error) {
      console.error("Sign-in event recording failed", error);
    }
  };
}

export type AuthEventWriter = ReturnType<typeof createAuthEventWriter>;
