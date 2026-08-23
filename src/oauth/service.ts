import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { AppConfig } from "../config.js";
import type { Database } from "../database/client.js";
import { secretMatches, type StoredClientMetadata } from "../database/seed.js";
import {
  authorizationCodes,
  authorizationConsents,
  authorizationRequests,
  clientSecrets,
  oidcClients,
  refreshTokens,
  resourceServers,
} from "../database/schema.js";
import type { IdentityService } from "../identity.js";
import { hashToken, isValidS256PkceRequest, randomToken, verifyS256Pkce } from "./crypto.js";
import { OAuthError } from "./errors.js";
import type { KeyService } from "./keys.js";
import { scopesCover } from "./scopes.js";

const identityScopes = new Set(["openid", "profile", "email", "permissions", "offline_access"]);

export interface OAuthClient {
  clientId: string;
  secretHash: string | null;
  resources: string[];
  requireConsent: boolean;
  filterMode: "whitelist" | "blacklist" | null;
  filterContent: string[];
  metadata: StoredClientMetadata;
}

function parseMetadata(value: Record<string, unknown>): StoredClientMetadata {
  if (
    typeof value.name !== "string" ||
    !Array.isArray(value.redirectUris) ||
    typeof value.public !== "boolean" ||
    !Array.isArray(value.scopes)
  ) {
    throw new Error("Stored client metadata is invalid");
  }
  return value as StoredClientMetadata;
}

/**
 * Enforces a client's email whitelist/blacklist. Shared by every path that
 * can mint an authorization code so SSO-session reuse cannot bypass filters.
 */
export function assertClientEmailAccess(
  client: Pick<OAuthClient, "filterMode" | "filterContent">,
  email: string,
) {
  const normalizedEmail = email.trim().toLowerCase();
  const matches = (client.filterContent ?? []).includes(normalizedEmail);
  if (
    (client.filterMode === "whitelist" && !matches) ||
    (client.filterMode === "blacklist" && matches)
  ) {
    throw new OAuthError(
      "access_denied",
      "This account is not allowed to sign in to this application.",
      403,
    );
  }
}

interface CachedClient {
  client: OAuthClient;
  expiresAt: number;
}

// Authorization flows read client configuration several times per request.
// Client rows change rarely, so parsed rows are memoized briefly; staleness
// is bounded by the TTL and callers mutating clients must invalidate.
const CLIENT_CACHE_TTL_MS = 30_000;
const clientCache = new Map<string, CachedClient>();

/** Drops a memoized client row; call after any direct write to `oidc_clients`. */
export function invalidateClient(clientId: string) {
  clientCache.delete(clientId);
}

export function createOAuthService(
  config: AppConfig,
  db: Database,
  keys: KeyService,
  identity: IdentityService,
) {
  async function clientById(clientId: string): Promise<OAuthClient | undefined> {
    const cached = clientCache.get(clientId);
    if (cached && cached.expiresAt > Date.now()) return cached.client;
    const [row] = await db
      .select()
      .from(oidcClients)
      .where(eq(oidcClients.clientId, clientId))
      .limit(1);
    if (!row) {
      clientCache.delete(clientId);
      return undefined;
    }
    const client: OAuthClient = { ...row, metadata: parseMetadata(row.metadata) };
    clientCache.set(clientId, { client, expiresAt: Date.now() + CLIENT_CACHE_TTL_MS });
    return client;
  }

  async function authenticateClient(clientId: string, secret?: string) {
    const client = await clientById(clientId);
    if (!client) throw new OAuthError("invalid_client", `Client "${clientId}" is not registered or has been disabled.`, 401, 14001);
    if (client.metadata.public) {
      if (secret) throw new OAuthError("invalid_client", "Public clients must not send a secret", 401, 14003);
      return client;
    }
    if (!secret) throw new OAuthError("invalid_client", "Client authentication failed", 401, 14004);
    // Legacy single-secret column first, then the rotation table. Any match
    // authenticates; portal-managed secrets also record last-used time.
    if (await secretMatches(secret, client.secretHash)) return client;
    const candidates = await db
      .select({ id: clientSecrets.id, secretHash: clientSecrets.secretHash })
      .from(clientSecrets)
      .where(
        and(
          eq(clientSecrets.clientId, clientId),
          isNull(clientSecrets.revokedAt),
          or(isNull(clientSecrets.expiresAt), gt(clientSecrets.expiresAt, new Date())),
        ),
      );
    let matchedId: string | undefined;
    for (const candidate of candidates) {
      if (await secretMatches(secret, candidate.secretHash)) {
        matchedId = candidate.id;
        break;
      }
    }
    if (!matchedId) throw new OAuthError("invalid_client", "Client authentication failed", 401, 14004);
    await db
      .update(clientSecrets)
      .set({ lastUsedAt: new Date() })
      .where(eq(clientSecrets.id, matchedId));
    return client;
  }

  async function startAuthorization(input: {
    initialUri: string;
    clientId?: string;
    redirectUri?: string;
    responseType?: string;
    scope?: string;
    resources: string[];
    state?: string;
    nonce?: string;
    codeChallenge?: string;
    codeChallengeMethod?: string;
    session?: { userId: string; authenticatedAt: Date };
  }) {
    if (!input.clientId) throw new OAuthError("invalid_request", "client_id is required");
    const client = await clientById(input.clientId);
    if (!client) throw new OAuthError("invalid_request", `Client "${input.clientId}" is not registered or has been disabled.`, 400, 14001);
    if (!input.redirectUri || !client.metadata.redirectUris.includes(input.redirectUri)) {
      throw new OAuthError("invalid_request", `redirect_uri is not registered for client "${client.metadata.name}"`, 400, 14100);
    }
    if (input.responseType == "token") {
      throw new OAuthError("unsupported_response_type", "response_type=token is deprecated for present OAuth2.1 client " + client.metadata.name + ". Adjust backward compatibilty in your developer portal.", 400, 14429);
    }
    if (input.responseType !== "code") {
      throw new OAuthError("unsupported_response_type", "Only response_type=code is supported", 400, 14429);
    }
    if (!input.state) throw new OAuthError("invalid_request", "state is required");
    if (!input.nonce) throw new OAuthError("invalid_request", "nonce is required");
    if (!isValidS256PkceRequest(input.codeChallenge, input.codeChallengeMethod)) {
      throw new OAuthError("invalid_request", "S256 PKCE is required");
    }
    const scopes = (input.scope ?? "").split(" ").filter(Boolean);
    if (!scopes.includes("openid")) {
      throw new OAuthError("invalid_scope", "The openid scope is required");
    }
    if (!scopesCover(client.metadata.scopes, scopes)) {
      throw new OAuthError("invalid_scope", "The client is not allowed to request one or more scopes", 400, 14401);
    }
    if (input.resources.length > 1) {
      throw new OAuthError("invalid_target", "Exactly one resource may be requested");
    }
    const resource = input.resources[0] ?? (client.resources.length === 1 ? client.resources[0] : undefined);
    if (!resource || !client.resources.includes(resource)) {
      throw new OAuthError("invalid_target", "The resource \"" + resource +"\" is not registered for this client", 400, 14501);
    }
    const [resourceServer] = await db
      .select()
      .from(resourceServers)
      .where(eq(resourceServers.audience, resource))
      .limit(1);
    if (!resourceServer) throw new OAuthError("invalid_target", "Unknown resource server", 14407);
    const customScopes = scopes.filter((scope) => !identityScopes.has(scope));
    if (!scopesCover(resourceServer.scopes, customScopes)) {
      throw new OAuthError("invalid_scope", "A requested scope is not supported by the resource", 400, 14401);
    }

    // SSO-session reuse must satisfy the same account checks as a fresh
    // upstream login: disabled accounts are rejected and client email
    // filters are enforced here rather than only in the upstream callback.
    if (input.session?.userId) {
      const core = await identity.findUserCore(input.session.userId);
      if (!core || core.disabled) {
        throw new OAuthError(
          "access_denied",
          "This account is not allowed to sign in to this application.",
          403,
        );
      }
      assertClientEmailAccess(client, core.email);
    }

    const id = crypto.randomUUID();
    const interactionToken = randomToken(32);
    await db.insert(authorizationRequests).values({
      id,
      initialUri: input.initialUri,
      interactionHash: hashToken(interactionToken),
      clientId: client.clientId,
      redirectUri: input.redirectUri,
      scopes,
      resource,
      state: input.state,
      nonce: input.nonce,
      codeChallenge: input.codeChallenge!,
      userId: input.session?.userId,
      authenticatedAt: input.session?.authenticatedAt,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    return { id, interactionToken };
  }

  async function interaction(requestId: string, interactionToken: string | undefined) {
    if (!interactionToken) throw new OAuthError("invalid_request", "Interaction cookie is missing");
    const [request] = await db
      .select()
      .from(authorizationRequests)
      .where(
        and(
          eq(authorizationRequests.id, requestId),
          eq(authorizationRequests.interactionHash, hashToken(interactionToken)),
          eq(authorizationRequests.status, "pending"),
          gt(authorizationRequests.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!request) throw new OAuthError("invalid_request", "Interaction is invalid or expired", 404, 2400);
    const client = await clientById(request.clientId);
    if (!client) throw new OAuthError("invalid_request", "Client no longer exists", 400, 14001);
    return { request, client };
  }

  async function getAuthorization(bridgeToken: string) {
    const [request] = await db
      .select()
      .from(authorizationRequests)
      .where(
        and(
          eq(authorizationRequests.interactionHash, hashToken(bridgeToken)),
          eq(authorizationRequests.status, "pending"),
          gt(authorizationRequests.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!request) throw new OAuthError("invalid_request", "Authorization request is invalid or expired", 400, 2400);
    return request;
  }

  async function getClient(clientId: string) {
    const client = await clientById(clientId);
    if (!client) throw new OAuthError("invalid_request", `Client "${clientId}" is not registered or has been disabled.`, 400, 14001);
    return {
      id: client.clientId,
      name: client.metadata.name,
      redirectUris: client.metadata.redirectUris,
      scopes: client.metadata.scopes,
      resources: client.resources,
      public: client.metadata.public,
    };
  }

  async function requiresConsent(request: typeof authorizationRequests.$inferSelect, client: OAuthClient) {
    if (!client.requireConsent) return false;
    if (!request.userId) return true;
    const [consent] = await db
      .select()
      .from(authorizationConsents)
      .where(
        and(
          eq(authorizationConsents.userId, request.userId),
          eq(authorizationConsents.clientId, request.clientId),
        ),
      )
      .limit(1);
    return !consent || !scopesCover(consent.scopes, request.scopes) || !consent.resources.includes(request.resource);
  }

  async function attachUser(requestId: string, userId: string, authenticatedAt: Date) {
    const rows = await db
      .update(authorizationRequests)
      .set({ userId, authenticatedAt })
      .where(
        and(
          eq(authorizationRequests.id, requestId),
          eq(authorizationRequests.status, "pending"),
          gt(authorizationRequests.expiresAt, new Date()),
        ),
      )
      .returning({ id: authorizationRequests.id });
    if (!rows.length) throw new OAuthError("invalid_request", "Authorization request expired");
  }

  async function clearInteractionUser(requestId: string) {
    const rows = await db
      .update(authorizationRequests)
      .set({ userId: null, authenticatedAt: null })
      .where(
        and(
          eq(authorizationRequests.id, requestId),
          eq(authorizationRequests.status, "pending"),
          gt(authorizationRequests.expiresAt, new Date()),
        ),
      )
      .returning({ id: authorizationRequests.id });
    if (!rows.length) throw new OAuthError("invalid_request", "Authorization request expired");
  }

  async function grantConsent(request: typeof authorizationRequests.$inferSelect) {
    if (!request.userId) throw new OAuthError("invalid_request", "User is not authenticated");
    const [existing] = await db
      .select()
      .from(authorizationConsents)
      .where(
        and(
          eq(authorizationConsents.userId, request.userId),
          eq(authorizationConsents.clientId, request.clientId),
        ),
      )
      .limit(1);
    const scopes = [...new Set([...(existing?.scopes ?? []), ...request.scopes])];
    const resources = [...new Set([...(existing?.resources ?? []), request.resource])];
    await db
      .insert(authorizationConsents)
      .values({ userId: request.userId, clientId: request.clientId, scopes, resources })
      .onConflictDoUpdate({
        target: [authorizationConsents.userId, authorizationConsents.clientId],
        set: { scopes, resources, updatedAt: new Date() },
      });
  }

  async function completeAuthorization(requestId: string) {
    const code = randomToken(48);
    const codeHash = hashToken(code);
    const request = await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(authorizationRequests)
        .set({ status: "completed" })
        .where(
          and(
            eq(authorizationRequests.id, requestId),
            eq(authorizationRequests.status, "pending"),
            gt(authorizationRequests.expiresAt, new Date()),
          ),
        )
        .returning();
      if (!claimed?.userId || !claimed.authenticatedAt) {
        throw new OAuthError("invalid_request", "Authorization request is not ready");
      }
      await tx.insert(authorizationCodes).values({
        codeHash,
        requestId: claimed.id,
        clientId: claimed.clientId,
        redirectUri: claimed.redirectUri,
        userId: claimed.userId,
        scopes: claimed.scopes,
        resource: claimed.resource,
        nonce: claimed.nonce,
        codeChallenge: claimed.codeChallenge,
        authenticatedAt: claimed.authenticatedAt,
        expiresAt: new Date(Date.now() + 60 * 1000),
      });
      return claimed;
    });
    const redirect = new URL(request.redirectUri);
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("state", request.state);
    return redirect.toString();
  }

  function denialRedirect(request: typeof authorizationRequests.$inferSelect) {
    const redirect = new URL(request.redirectUri);
    redirect.searchParams.set("error", "access_denied");
    redirect.searchParams.set("error_description", "The user denied access");
    redirect.searchParams.set("state", request.state);
    return redirect.toString();
  }

  async function denyAuthorization(request: typeof authorizationRequests.$inferSelect) {
    await db
      .update(authorizationRequests)
      .set({ status: "denied" })
      .where(
        and(
          eq(authorizationRequests.id, request.id),
          eq(authorizationRequests.status, "pending"),
        ),
      );
    return denialRedirect(request);
  }

  async function issueTokenSet(input: {
    userId: string;
    clientId: string;
    scopes: string[];
    resource: string;
    nonce?: string;
    authenticatedAt?: Date;
    familyId?: string;
    refreshExpiresAt?: Date;
  }) {
    const user = await identity.findUser(input.userId);
    if (!user || user.disabled) {
      if (input.familyId) {
        await db
          .update(refreshTokens)
          .set({ revokedAt: new Date() })
          .where(eq(refreshTokens.familyId, input.familyId));
      }
      throw new OAuthError("invalid_grant", "User is missing or disabled");
    }
    const accessToken = await keys.issueAccessToken(input);
    const response: Record<string, unknown> = {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 600,
      scope: input.scopes.join(" "),
    };
    if (input.nonce && input.authenticatedAt) {
      response.id_token = await keys.issueIdToken({ ...input, accessToken, nonce: input.nonce, authenticatedAt: input.authenticatedAt });
    }
    if (input.scopes.includes("offline_access")) {
      const refreshToken = randomToken(64);
      await db.insert(refreshTokens).values({
        tokenHash: hashToken(refreshToken),
        familyId: input.familyId ?? crypto.randomUUID(),
        clientId: input.clientId,
        userId: input.userId,
        scopes: input.scopes,
        resource: input.resource,
        expiresAt: input.refreshExpiresAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
      response.refresh_token = refreshToken;
    }
    return response;
  }

  async function exchangeAuthorizationCode(input: {
    code: string;
    clientId: string;
    clientSecret?: string;
    redirectUri?: string;
    codeVerifier?: string;
  }) {
    await authenticateClient(input.clientId, input.clientSecret);
    const [authorizationCode] = await db
      .select()
      .from(authorizationCodes)
      .where(
        and(
          eq(authorizationCodes.codeHash, hashToken(input.code)),
          gt(authorizationCodes.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (
      !authorizationCode ||
      authorizationCode.clientId !== input.clientId ||
      !input.codeVerifier ||
      // RFC 6749 section 4.1.3: redirect_uri, when it was part of the
      // authorization request, is REQUIRED here and must match exactly.
      input.redirectUri !== authorizationCode.redirectUri ||
      !verifyS256Pkce(input.codeVerifier, authorizationCode.codeChallenge)
    ) {
      throw new OAuthError("invalid_grant", "Authorization code exchange failed");
    }
    const consumed = await db
      .update(authorizationCodes)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(authorizationCodes.codeHash, authorizationCode.codeHash),
          isNull(authorizationCodes.consumedAt),
        ),
      )
      .returning({ codeHash: authorizationCodes.codeHash });
    if (!consumed.length) throw new OAuthError("invalid_grant", "Authorization code was already used");
    return issueTokenSet({
      userId: authorizationCode.userId,
      clientId: authorizationCode.clientId,
      scopes: authorizationCode.scopes,
      resource: authorizationCode.resource,
      nonce: authorizationCode.nonce,
      authenticatedAt: authorizationCode.authenticatedAt,
    });
  }

  async function exchangeRefreshToken(input: {
    refreshToken: string;
    clientId: string;
    clientSecret?: string;
  }) {
    await authenticateClient(input.clientId, input.clientSecret);
    const tokenHash = hashToken(input.refreshToken);
    // Consume-and-rotate runs as one atomic statement: the guarded UPDATE
    // claims the token, and a sibling CTE revokes the family when the claim
    // fails for an already-used token of the same client. Unknown tokens and
    // foreign-client tokens never trigger revocation, matching the original
    // three-statement flow in a single round trip.
    const claimed = await db.execute<{
      user_id: string;
      scopes: string[];
      resource: string;
      family_id: string;
      expires_at: Date;
    }>(sql`
      with claimed as (
        update refresh_tokens
        set consumed_at = now()
        where token_hash = ${tokenHash}
          and client_id = ${input.clientId}
          and consumed_at is null
          and revoked_at is null
          and expires_at > now()
        returning user_id, scopes, resource, family_id, expires_at
      ), revoke_stale as (
        update refresh_tokens
        set revoked_at = now()
        where family_id = (select family_id from refresh_tokens where token_hash = ${tokenHash})
          and exists (
            select 1 from refresh_tokens
            where token_hash = ${tokenHash}
              and client_id = ${input.clientId}
          )
          and not exists (select 1 from claimed)
      )
      select user_id, scopes, resource, family_id, expires_at from claimed
    `);
    const [row] = claimed.rows;
    if (!row) {
      const [stored] = await db
        .select({ clientId: refreshTokens.clientId })
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, tokenHash))
        .limit(1);
      if (stored && stored.clientId === input.clientId) {
        throw new OAuthError("invalid_grant", "Refresh token reuse detected");
      }
      throw new OAuthError("invalid_grant", "Refresh token is invalid");
    }
    return issueTokenSet({
      userId: row.user_id,
      clientId: input.clientId,
      scopes: row.scopes,
      resource: row.resource,
      familyId: row.family_id,
      refreshExpiresAt: row.expires_at,
    });
  }

  async function revoke(token: string, clientId: string, clientSecret?: string) {
    await authenticateClient(clientId, clientSecret);
    const [stored] = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hashToken(token)))
      .limit(1);
    if (stored?.clientId === clientId) {
      await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.familyId, stored.familyId));
    }
  }

  async function userInfo(accessToken: string) {
    let payload: Awaited<ReturnType<KeyService["verifyAccessToken"]>>;
    try {
      payload = await keys.verifyAccessToken(accessToken);
    } catch {
      throw new OAuthError("invalid_token", "Access token is invalid", 401);
    }
    const account = await identity.findAccount(payload.sub);
    if (!account) throw new OAuthError("invalid_token", "User no longer exists", 401);
    return account.claims("userinfo", payload.scope);
  }

  return {
    clientById,
    invalidateClient,
    authenticateClient,
    startAuthorization,
    interaction,
    getAuthorization,
    getClient,
    requiresConsent,
    attachUser,
    clearInteractionUser,
    grantConsent,
    completeAuthorization,
    denialRedirect,
    denyAuthorization,
    exchangeAuthorizationCode,
    exchangeRefreshToken,
    revoke,
    userInfo,
  };
}

export type OAuthService = ReturnType<typeof createOAuthService>;
