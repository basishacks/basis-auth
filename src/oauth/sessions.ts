import { and, eq, gt } from "drizzle-orm";
import type { Database } from "../database/client.js";
import { authSessions } from "../database/schema.js";
import { hashToken, randomToken } from "./crypto.js";

export function createSessionService(db: Database) {
  async function create(userId: string) {
    const token = randomToken(48);
    const authenticatedAt = new Date();
    await db.insert(authSessions).values({
      idHash: hashToken(token),
      userId,
      authenticatedAt,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
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
    return session;
  }

  async function destroy(token: string | undefined) {
    if (token) await db.delete(authSessions).where(eq(authSessions.idHash, hashToken(token)));
  }

  return { create, find, destroy };
}

export type SessionService = ReturnType<typeof createSessionService>;
