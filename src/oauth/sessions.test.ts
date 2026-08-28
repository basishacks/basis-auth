import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionService } from "./sessions.js";

function makeDb() {
  const store = new Map<string, Record<string, unknown>>();
  const updateSpy = vi.fn(() => Promise.resolve());
  const db = {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        store.set(values.idHash as string, values);
        return Promise.resolve();
      },
    }),
    delete: () => ({
      where: () => {
        store.clear();
        return Promise.resolve();
      },
    }),
    update: () => ({
      set: () => ({
        where: () => {
          updateSpy();
          return Promise.resolve();
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [...store.values()],
        }),
      }),
    }),
  } as unknown as Parameters<typeof createSessionService>[0];
  return { db, updateSpy };
}

describe("session idle timeout", () => {
  let db: ReturnType<typeof makeDb>["db"];
  let updateSpy: ReturnType<typeof makeDb>["updateSpy"];
  let sessions: ReturnType<typeof createSessionService>;

  beforeEach(() => {
    const built = makeDb();
    db = built.db;
    updateSpy = built.updateSpy;
    sessions = createSessionService(db);
  });

  it("creates and finds an active session", async () => {
    const token = await sessions.create("user-1");
    const session = await sessions.find(token);
    expect(session?.userId).toBe("user-1");
  });

  it("drops a session that has gone idle", async () => {
    const token = await sessions.create("user-2");
    const session = (await sessions.find(token))!;
    session.lastSeenAt = new Date(Date.now() - 13 * 60 * 60 * 1000);
    expect(await sessions.find(token)).toBeUndefined();
  });

  it("refreshes last-seen without dropping a recently active session", async () => {
    const token = await sessions.create("user-3");
    const session = (await sessions.find(token))!;
    session.lastSeenAt = new Date(Date.now() - 6 * 60 * 1000);
    const again = await sessions.find(token);
    expect(again?.userId).toBe("user-3");
    expect(updateSpy).toHaveBeenCalledOnce();
  });

  it("returns undefined for an unauthenticated request", async () => {
    expect(await sessions.find(undefined)).toBeUndefined();
  });

  it("removes the session on destroy", async () => {
    const token = await sessions.create("user-4");
    await sessions.destroy(token);
    expect(await sessions.find(token)).toBeUndefined();
  });
});
