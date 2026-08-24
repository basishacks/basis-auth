import { createHmac, timingSafeEqual } from "node:crypto";
import * as oidc from "openid-client";
import { and, eq, gt, sql } from "drizzle-orm";
import type { Database } from "../../src/database/client.js";
import { adminSessions } from "../../src/database/schema.js";
import { hashToken, randomToken } from "../../src/oauth/crypto.js";
import type { AdminConfig } from "../config.js";
import { selectPortalPermissions } from "./permissions.js";
import { HttpGuardError, type AdminContext } from "./context.js";

const BRIDGE_MAX_AGE_SECONDS = 10 * 60;

export interface PortalAccount {
  userId: string;
  email: string;
  disabled: boolean;
  permissions: string[];
}

/** Loads the account plus its permission list in a single round trip. */
export async function loadPortalAccount(db: Database, userId: string): Promise<PortalAccount | undefined> {
  const result = await db.execute<{
    id: string;
    email: string;
    disabled: boolean;
    permissions: string[];
  }>(sql`
    select u.id, u.email, u.disabled,
      coalesce((
        select json_agg(p.permission order by p.permission)
        from user_permissions p
        where p.user_id = u.id
      ), '[]'::json) as permissions
    from users u
    where u.id = ${userId}
    limit 1
  `);
  const account = result.rows[0];
  if (!account) return undefined;
  return {
    userId: account.id,
    email: account.email,
    disabled: account.disabled,
    permissions: Array.isArray(account.permissions) ? account.permissions : [],
  };
}

interface BridgePayload {
  state: string;
  nonce: string;
  verifier: string;
}

function signBridge(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function encodeBridge(secret: string, payload: BridgePayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${signBridge(secret, body)}`;
}

function decodeBridge(secret: string, value: string): BridgePayload | undefined {
  const separator = value.lastIndexOf(".");
  if (separator < 1) return undefined;
  const body = value.slice(0, separator);
  const supplied = Buffer.from(value.slice(separator + 1));
  const expected = Buffer.from(signBridge(secret, body));
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (
      typeof parsed !== "object" ||
      typeof (parsed as BridgePayload).state !== "string" ||
      typeof (parsed as BridgePayload).nonce !== "string" ||
      typeof (parsed as BridgePayload).verifier !== "string"
    ) {
      return undefined;
    }
    return parsed as BridgePayload;
  } catch {
    return undefined;
  }
}

export function createAdminAuthService(config: AdminConfig, db: Database) {
  let discovered: Promise<oidc.Configuration> | undefined;

  // openid-client refuses plaintext HTTP by default; local development runs
  // the IdP over plain HTTP, so insecure requests are allowed there only.
  const devRequestOptions: Record<string, unknown> = config.environment === "production"
    ? {}
    : { execute: [oidc.allowInsecureRequests] };

  function configuration() {
    discovered ??= oidc.discovery(
      new URL(config.issuer),
      config.clientId,
      undefined,
      undefined,
      devRequestOptions,
    );
    return discovered;
  }

  /** Creates a signed login attempt and its authorization redirect target. */
  async function startLogin(): Promise<{ redirectTo: string; bridge: string }> {
    const configuration_ = await configuration();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const verifier = oidc.randomPKCECodeVerifier();
    const challenge = await oidc.calculatePKCECodeChallenge(verifier);
    const redirectTo = oidc.buildAuthorizationUrl(configuration_, {
      redirect_uri: `${config.publicUrl}/auth/callback`,
      scope: "openid profile permissions",
      response_type: "code",
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).href;
    // prompt=login support lets step-up reuse this exact flow.
    return { redirectTo, bridge: encodeBridge(config.cookieKeys[0]!, { state, nonce, verifier }) };
  }

  async function createNewSession(userId: string, ip?: string | null, userAgent?: string | null) {
    const token = randomToken(48);
    const now = new Date();
    await db.insert(adminSessions).values({
      idHash: hashToken(token),
      userId,
      authTime: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + config.sessionTtlHours * 3_600_000),
      ip: ip ?? null,
      userAgent: userAgent ?? null,
    });
    return token;
  }

  /**
   * Exchanges the upstream callback for an admin session.
   *
   * When `existingRawToken` belongs to a live session it is treated as a
   * step-up: only the stored authentication time advances, so the operator
   * keeps their session while satisfying the freshness requirement.
   */
  async function handleCallback(input: {
    callbackUrl: URL;
    bridge: string | undefined;
    existingRawToken: string | undefined;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<{ sessionToken: string; steppedUp: boolean }> {
    const bridge = input.bridge ? decodeBridge(config.cookieKeys[0]!, input.bridge) : undefined;
    if (!bridge) throw new HttpGuardError(400, "invalid_request", "Login attempt expired");
    const configuration_ = await configuration();
    const tokens = await oidc.authorizationCodeGrant(
      configuration_,
      input.callbackUrl,
      {
        pkceCodeVerifier: bridge.verifier,
        expectedState: bridge.state,
        expectedNonce: bridge.nonce,
      },
      undefined,
      devRequestOptions,
    );
    const claims = tokens.claims();
    if (!claims?.sub) throw new HttpGuardError(400, "invalid_request", "Upstream identity missing");

    const account = await loadPortalAccount(db, claims.sub);
    if (!account || account.disabled) {
      throw new HttpGuardError(403, "access_denied", "This account cannot access the portal");
    }
    if (selectPortalPermissions(account.permissions).length === 0) {
      throw new HttpGuardError(403, "forbidden", "This account has no portal permissions");
    }

    if (input.existingRawToken) {
      const [session] = await db
        .update(adminSessions)
        .set({ authTime: new Date(), lastSeenAt: new Date() })
        .where(
          and(
            eq(adminSessions.idHash, hashToken(input.existingRawToken)),
            eq(adminSessions.userId, account.userId),
            gt(adminSessions.expiresAt, new Date()),
          ),
        )
        .returning({ idHash: adminSessions.idHash });
      if (session) return { sessionToken: input.existingRawToken, steppedUp: true };
    }

    const sessionToken = await createNewSession(account.userId, input.ip, input.userAgent);
    return { sessionToken, steppedUp: false };
  }

  /**
   * Resolves the caller's session into a live context. Permissions are
   * loaded fresh on every request so revocations apply immediately.
   */
  async function validateSession(rawToken: string | undefined): Promise<AdminContext | undefined> {
    if (!rawToken) return undefined;
    const idHash = hashToken(rawToken);
    const result = await db.execute<{
      user_id: string;
      email: string;
      auth_time: Date;
      permissions: string[];
    }>(sql`
      select s.user_id, u.email, s.auth_time,
        coalesce((
          select json_agg(p.permission order by p.permission)
          from user_permissions p
          where p.user_id = s.user_id
        ), '[]'::json) as permissions
      from admin_sessions s
      join users u on u.id = s.user_id
      where s.id_hash = ${idHash} and s.expires_at > now() and u.disabled = false
      limit 1
    `);
    const record = result.rows[0];
    if (!record) return undefined;
    const permissions = selectPortalPermissions(
      Array.isArray(record.permissions) ? record.permissions : [],
    );
    if (permissions.length === 0) return undefined;
    return {
      sessionIdHash: idHash,
      userId: record.user_id,
      email: record.email,
      permissions: new Set(permissions),
      authTime: new Date(record.auth_time),
    };
  }

  async function destroySession(rawToken: string | undefined) {
    if (!rawToken) return;
    await db.delete(adminSessions).where(eq(adminSessions.idHash, hashToken(rawToken)));
  }

  return { startLogin, handleCallback, validateSession, destroySession };
}

export type AdminAuthService = ReturnType<typeof createAdminAuthService>;
export { BRIDGE_MAX_AGE_SECONDS };
