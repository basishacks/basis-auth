import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    provider: text("provider").notNull(),
    upstreamIssuer: text("upstream_issuer").notNull(),
    upstreamSubject: text("upstream_subject").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    disabled: boolean("disabled").notNull().default(false),
    displayName: text("display_name"),
    picture: bytea("picture"),
    pictureContentType: text("picture_content_type"),
    tokensValidAfter: timestamp("tokens_valid_after", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_upstream_identity_unique").on(
      table.provider,
      table.upstreamIssuer,
      table.upstreamSubject,
    ),
    index("users_email_idx").on(table.email),
    // Case-insensitive uniqueness so two accounts cannot share one address.
    uniqueIndex("users_email_normalized_unique").on(sql`lower(${table.email})`),
  ],
);

export const userPermissions = pgTable(
  "user_permissions",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.permission] })],
);

export const oidcClients = pgTable(
  "oidc_clients",
  {
    clientId: text("client_id").primaryKey(),
    metadata: jsonb("metadata").notNull().$type<Record<string, unknown>>(),
    secretHash: text("secret_hash"),
    resources: jsonb("resources").notNull().$type<string[]>(),
    requireConsent: boolean("require_consent").notNull().default(true),
    filterMode: text("filter_mode").$type<"whitelist" | "blacklist" | null>(),
    filterContent: jsonb("filter_content").notNull().default([]).$type<string[]>(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "oidc_clients_filter_mode_check",
      sql`${table.filterMode} in ('whitelist', 'blacklist') or ${table.filterMode} is null`,
    ),
  ],
);

export const resourceServers = pgTable("resource_servers", {
  audience: text("audience").primaryKey(),
  scopes: jsonb("scopes").notNull().$type<string[]>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const authSessions = pgTable(
  "auth_sessions",
  {
    idHash: text("id_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    authenticatedAt: timestamp("authenticated_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("auth_sessions_expires_at_idx").on(table.expiresAt)],
);

export const authorizationRequests = pgTable(
  "authorization_requests",
  {
    id: uuid("id").primaryKey(),
    initialUri: text("initial_uri").notNull(),
    interactionHash: text("interaction_hash").notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => oidcClients.clientId, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    scopes: jsonb("scopes").notNull().$type<string[]>(),
    resource: text("resource").notNull(),
    state: text("state").notNull(),
    nonce: text("nonce").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    authenticatedAt: timestamp("authenticated_at", { withTimezone: true }),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("authorization_requests_expires_at_idx").on(table.expiresAt)],
);

export const authorizationCodes = pgTable(
  "authorization_codes",
  {
    codeHash: text("code_hash").primaryKey(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => authorizationRequests.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => oidcClients.clientId, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scopes: jsonb("scopes").notNull().$type<string[]>(),
    resource: text("resource").notNull(),
    nonce: text("nonce").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    authenticatedAt: timestamp("authenticated_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => [index("authorization_codes_expires_at_idx").on(table.expiresAt)],
);

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    familyId: uuid("family_id").notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => oidcClients.clientId, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scopes: jsonb("scopes").notNull().$type<string[]>(),
    resource: text("resource").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("refresh_tokens_family_id_idx").on(table.familyId),
    index("refresh_tokens_expires_at_idx").on(table.expiresAt),
  ],
);

export const authorizationConsents = pgTable(
  "authorization_consents",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => oidcClients.clientId, { onDelete: "cascade" }),
    scopes: jsonb("scopes").notNull().$type<string[]>(),
    resources: jsonb("resources").notNull().$type<string[]>(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.clientId] })],
);

export const upstreamAuthRequests = pgTable(
  "upstream_auth_requests",
  {
    state: text("state").primaryKey(),
    authorizationRequestId: uuid("authorization_request_id")
      .notNull()
      .references(() => authorizationRequests.id, { onDelete: "cascade" }),
    codeVerifier: text("code_verifier").notNull(),
    nonce: text("nonce").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("upstream_auth_requests_expires_at_idx").on(table.expiresAt)],
);

// ---------------------------------------------------------------------------
// Management portal tables. audit_events and auth_events are append-only at
// the database level: the portal role receives SELECT and INSERT grants only.
// ---------------------------------------------------------------------------

export const clientSecrets = pgTable(
  "client_secrets",
  {
    id: uuid("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oidcClients.clientId, { onDelete: "cascade" }),
    name: text("name").notNull(),
    secretHash: text("secret_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("client_secrets_client_id_idx").on(table.clientId),
    index("client_secrets_active_idx")
      .on(table.clientId)
      .where(sql`revoked_at is null`),
  ],
);

export const localCredentials = pgTable("local_credentials", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  passwordHash: text("password_hash"),
  passwordUpdatedAt: timestamp("password_updated_at", { withTimezone: true }),
  mustResetPassword: boolean("must_reset_password").notNull().default(false),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  totpSecretEnc: bytea("totp_secret_enc"),
  totpConfirmedAt: timestamp("totp_confirmed_at", { withTimezone: true }),
  // Array of hashed single-use recovery codes; plaintext never stored.
  recoveryCodes: jsonb("recovery_codes").notNull().default([]).$type<string[]>(),
});

export const adminSessions = pgTable(
  "admin_sessions",
  {
    idHash: text("id_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    authTime: timestamp("auth_time", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (table) => [index("admin_sessions_expires_at_idx").on(table.expiresAt)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    beforeState: jsonb("before_state"),
    afterState: jsonb("after_state"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_events_created_at_idx").on(table.createdAt),
    index("audit_events_actor_idx").on(table.actorUserId),
    index("audit_events_target_idx").on(table.targetType, table.targetId),
  ],
);

export const authEvents = pgTable(
  "auth_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    provider: text("provider"),
    clientId: text("client_id"),
    success: boolean("success").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("auth_events_created_at_idx").on(table.createdAt),
    index("auth_events_user_idx").on(table.userId),
    index("auth_events_client_kind_idx").on(table.clientId, table.kind),
  ],
);

export const appAssets = pgTable(
  "app_assets",
  {
    clientId: text("client_id")
      .notNull()
      .references(() => oidcClients.clientId, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    bytes: bytea("bytes").notNull(),
    contentType: text("content_type").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.clientId, table.kind] })],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
