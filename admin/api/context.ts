import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { eq, sql } from "drizzle-orm";
import type { Database } from "../../src/database/client.js";
import {
  adminSessions,
  auditEvents,
  localCredentials,
  oidcClients,
  refreshTokens,
  settings,
  userPermissions,
  users,
} from "../../src/database/schema.js";
import type { PortalPermission } from "./permissions.js";

export interface AdminContext {
  sessionIdHash: string;
  userId: string;
  email: string;
  permissions: ReadonlySet<PortalPermission>;
  authTime: Date;
}

export interface Env {
  Variables: {
    admin: AdminContext;
  };
}

/** Shared hono environment for every portal route module. */
export interface AppEnv {
  Bindings: Record<string, string>;
  Variables: Env["Variables"] & { ip?: string };
}

const LOCKOUT_KEY = "admin_locked";

/** Reads the persisted global lockout switch. */
export async function isLocked(db: Database): Promise<boolean> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, LOCKOUT_KEY))
    .limit(1);
  return row?.value === true;
}

export async function setLocked(db: Database, locked: boolean): Promise<void> {
  await db
    .insert(settings)
    .values({ key: LOCKOUT_KEY, value: locked })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: locked, updatedAt: new Date() },
    });
}

/**
 * Appends an immutable audit record. The portal database role has no UPDATE
 * or DELETE grants on audit_events, so history cannot be rewritten even by a
 * full application compromise.
 */
export async function writeAudit(
  db: Database,
  entry: {
    actorUserId?: string | null;
    action: string;
    targetType: string;
    targetId: string;
    beforeState?: unknown;
    afterState?: unknown;
    ip?: string | null;
    userAgent?: string | null;
  },
) {
  await db.insert(auditEvents).values({
    actorUserId: entry.actorUserId ?? null,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    beforeState: (entry.beforeState ?? null) as never,
    afterState: (entry.afterState ?? null) as never,
    ip: entry.ip ?? null,
    userAgent: entry.userAgent ?? null,
  });
}

export function csrfTokenFor(secret: string, sessionIdHash: string): string {
  return createHmac("sha256", secret).update(`admin:${sessionIdHash}`).digest("base64url");
}

export function csrfValid(secret: string, sessionIdHash: string, supplied?: string): boolean {
  if (!supplied) return false;
  const expected = Buffer.from(csrfTokenFor(secret, sessionIdHash));
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * True when the target account itself holds any portal permission; such
 * accounts are shielded behind portal.privileged.read.
 */
export async function targetIsPrivileged(db: Database, userId: string): Promise<boolean> {
  const rows = await db
    .select({ permission: userPermissions.permission })
    .from(userPermissions)
    .where(
      sql`${userPermissions.userId} = ${userId} and ${userPermissions.permission} like 'portal.%'`,
    );
  return rows.length > 0;
}

/**
 * Guardrail: refuses to demote or disable the last remaining holder of a
 * critical permission, so the portal can never lock out all of its own
 * administrators through the UI. Break-glass remains available via CLI.
 */
export async function assertNotLastAdmin(
  db: Database,
  permission: PortalPermission,
  excludingUserId?: string,
) {
  const holders = await db
    .select({ userId: userPermissions.userId })
    .from(userPermissions)
    .where(eq(userPermissions.permission, permission));
  const remaining = holders.filter((row) => row.userId !== excludingUserId);
  if (holders.length >= 1 && remaining.length === 0 && !excludingUserId) {
    throw new HttpGuardError(409, "last_admin", `The last holder of ${permission} cannot be removed`);
  }
}

export class HttpGuardError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Lists users with pagination via keyset cursor on creation time. */
export function keysetCursor(searchParams: URLSearchParams): { createdAt: Date; id: string } | undefined {
  const raw = searchParams.get("cursor");
  if (!raw) return undefined;
  const separator = raw.indexOf("_");
  if (separator < 1) return undefined;
  const timestamp = Number(raw.slice(0, separator));
  const id = raw.slice(separator + 1);
  if (!Number.isFinite(timestamp) || !id) return undefined;
  return { createdAt: new Date(timestamp), id };
}

export function nextKeysetCursor(row: { createdAt: Date; id: string }): string {
  return `${row.createdAt.getTime()}_${row.id}`;
}

// Re-exported so route modules share one import site for common tables.
export { adminSessions, localCredentials, oidcClients, refreshTokens, userPermissions, users };
