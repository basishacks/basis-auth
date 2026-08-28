import { and, eq, gt } from "drizzle-orm";
import type { Database } from "../database/client.js";
import { authSessions } from "../database/schema.js";
import { hashToken, randomToken } from "./crypto.js";

const IDLE_TIMEOUT_MS = Number(process.env.SESSION_IDLE_TIMEOUT_MS) || 12 * 60 * 60 * 1000;
const ABSOLUTE_MAX_MS = Number(process.env.SESSION_ABSOLUTE_MAX_MS) || 30 * 24 * 60 * 60 * 1000;
const LAST_SEEN_UPDATE_INTERVAL_MS = 5 * 60 * 1000;

export function createSessionService(db: Database) {
  async function create(userId: string) {
    const token = randomToken(48);
    const now = new Date();
    await db.insert(authSessions).values({
      idHash: hashToken(token),
      userId,
      authenticatedAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + ABSOLUTE_MAX_MS),
    });
    return token;
  }

  async function find(token: string | undefined) {
    if (!token) return undefined;
    const [session] = await db
      .select()
      .from(authSessions)
      .where(
        and(
          eq(authSessions.idHash, hashToken(token)),
          gt(authSessions.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!session) return undefined;
    const now = Date.now();
    if (now - session.lastSeenAt.getTime() > IDLE_TIMEOUT_MS) return undefined;
    if (now - session.lastSeenAt.getTime() > LAST_SEEN_UPDATE_INTERVAL_MS) {
      await db
        .update(authSessions)
        .set({ lastSeenAt: new Date() })
        .where(eq(authSessions.idHash, hashToken(token)));
    }
    return session;
  }

  async function destroy(token: string | undefined) {
    if (token) await db.delete(authSessions).where(eq(authSessions.idHash, hashToken(token)));
  }

  return { create, find, destroy };
}

export type SessionService = ReturnType<typeof createSessionService>;
