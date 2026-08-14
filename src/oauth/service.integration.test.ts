import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { loadConfig, type AppConfig } from "../config.js";
import { createDatabase, type Database } from "../database/client.js";
import { migrateDatabase } from "../database/migrate.js";
import { seedConfiguration } from "../database/seed.js";
import { createIdentityService, type IdentityService } from "../identity.js";
import { createKeyService, type KeyService } from "./keys.js";
import { createOAuthService, type OAuthService } from "./service.js";

describe.skipIf(process.env.RUN_POSTGRES_TESTS !== "1")("OAuth flow with PostgreSQL", () => {
  let container: StartedPostgreSqlContainer;
  let db: Database;
  let close: () => Promise<void>;
  let config: AppConfig;
  let identity: IdentityService;
  let keys: KeyService;
  let oauth: OAuthService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17-alpine").start();
    const databaseUrl = container.getConnectionUri();
    config = await loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      OIDC_ISSUER: "https://auth.example.test",
      OIDC_COOKIE_KEYS: "a".repeat(32),
      OIDC_RESOURCES_JSON: JSON.stringify([
        { audience: "urn:basis:api:projects", scopes: ["projects.read"] },
      ]),
      OIDC_CLIENTS_JSON: JSON.stringify([
        {
          clientId: "portal",
          clientSecret: "portal-secret-long-enough",
          redirectUris: ["https://portal.example.test/callback"],
          public: false,
          scopes: ["openid", "profile", "email", "permissions", "offline_access", "projects.read"],
          resources: ["urn:basis:api:projects"],
          requireConsent: false,
        },
      ]),
    });
    await migrateDatabase(databaseUrl);
    const database = createDatabase(databaseUrl);
    db = database.db;
    close = () => database.pool.end();
    await seedConfiguration(db, config.clients, config.resources);
    identity = createIdentityService(db, "participant", []);
    keys = await createKeyService(config, identity);
    oauth = createOAuthService(config, db, keys, identity);
  }, 120_000);

  afterAll(async () => {
    await close?.();
    await container?.stop();
  });

  it("issues audience-bound tokens, rejects code replay, and detects refresh reuse", async () => {
    const user = await identity.upsertFromMicrosoft({
      provider: "basischina-microsoft",
      issuer: "https://login.microsoftonline.com/tenant/v2.0",
      subject: "microsoft-subject",
      email: "user@example.edu",
      emailVerified: true,
      displayName: "Example User",
    });
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const started = await oauth.startAuthorization({
      initialUri: "/oauth/authorize",
      clientId: "portal",
      redirectUri: "https://portal.example.test/callback",
      responseType: "code",
      scope: "openid profile email permissions offline_access projects.read",
      resources: ["urn:basis:api:projects"],
      state: "state",
      nonce: "nonce",
      codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      codeChallengeMethod: "S256",
      session: { userId: user.id, authenticatedAt: new Date() },
    });
    const redirect = new URL(await oauth.completeAuthorization(started.id));
    const code = redirect.searchParams.get("code")!;
    const tokens = await oauth.exchangeAuthorizationCode({
      code,
      clientId: "portal",
      clientSecret: "portal-secret-long-enough",
      redirectUri: "https://portal.example.test/callback",
      codeVerifier: verifier,
    });
    const access = await keys.verifyAccessToken(String(tokens.access_token));
    expect(access).toMatchObject({
      sub: user.id,
      aud: "urn:basis:api:projects",
      client_id: "portal",
      permissions: ["participant"],
    });
    await expect(
      oauth.exchangeAuthorizationCode({
        code,
        clientId: "portal",
        clientSecret: "portal-secret-long-enough",
        redirectUri: "https://portal.example.test/callback",
        codeVerifier: verifier,
      }),
    ).rejects.toMatchObject({ error: "invalid_grant" });

    const firstRefresh = String(tokens.refresh_token);
    const rotated = await oauth.exchangeRefreshToken({
      refreshToken: firstRefresh,
      clientId: "portal",
      clientSecret: "portal-secret-long-enough",
    });
    await expect(
      oauth.exchangeRefreshToken({
        refreshToken: firstRefresh,
        clientId: "portal",
        clientSecret: "portal-secret-long-enough",
      }),
    ).rejects.toMatchObject({ error: "invalid_grant" });
    await expect(
      oauth.exchangeRefreshToken({
        refreshToken: String(rotated.refresh_token),
        clientId: "portal",
        clientSecret: "portal-secret-long-enough",
      }),
    ).rejects.toMatchObject({ error: "invalid_grant" });
  });
});
