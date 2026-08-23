import { sql } from "drizzle-orm";
import type { Database } from "./client.js";

export interface PurgeResult {
  authSessions: number;
  authorizationRequests: number;
  authorizationCodes: number;
  refreshTokens: number;
  upstreamAuthRequests: number;
}

const MAX_BATCHES_PER_TABLE = 200;

/**
 * Removes expired authentication artifacts so indexes stay small and hot.
 *
 * Deletes run in bounded batches keyed on ctid, which keeps each statement
 * short-lived and avoids long row locks on busy tables. Consumed but
 * unexpired refresh tokens are intentionally retained: the reuse-detection
 * path must still find them to revoke their whole token family.
 */
export function createPurgeService(db: Database) {
  async function purgeBatch(table: string, whereSql: string, batchSize: number): Promise<number> {
    let total = 0;
    for (let batch = 0; batch < MAX_BATCHES_PER_TABLE; batch += 1) {
      const result = await db.execute(sql.raw(`
        with doomed as (
          select ctid from ${table} where ${whereSql} limit ${batchSize}
        )
        delete from ${table} using doomed where ${table}.ctid = doomed.ctid
      `));
      const removed = result.rowCount ?? 0;
      total += removed;
      if (removed < batchSize) break;
    }
    return total;
  }

  async function purgeExpired(batchSize = 5_000): Promise<PurgeResult> {
    return {
      authSessions: await purgeBatch("auth_sessions", "expires_at < now()", batchSize),
      authorizationRequests: await purgeBatch(
        "authorization_requests",
        "expires_at < now()",
        batchSize,
      ),
      authorizationCodes: await purgeBatch("authorization_codes", "expires_at < now()", batchSize),
      refreshTokens: await purgeBatch(
        "refresh_tokens",
        "expires_at < now() or revoked_at < now() - interval '7 days'",
        batchSize,
      ),
      upstreamAuthRequests: await purgeBatch(
        "upstream_auth_requests",
        "expires_at < now()",
        batchSize,
      ),
    };
  }

  return { purgeExpired };
}

export type PurgeService = ReturnType<typeof createPurgeService>;
