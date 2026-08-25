import { eq, sql } from "drizzle-orm";
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadAdminConfig } from "../../config.js";
import { createDatabase } from "../../../src/database/client.js";
import {
  authSessions,
  localCredentials,
  userPermissions,
  users,
} from "../../../src/database/schema.js";
import { createAdminApp } from "../app.js";
import { loadPortalAccount } from "../auth.js";
import { createIdentityService } from "../../../src/identity.js";
import { createPurgeService } from "../../../src/database/purge.js";
import { isLocked, setLocked } from "../context.js";
import type { AppEnv } from "../middleware.js";

describe.skipIf(process.env.RUN_POSTGRES_TESTS !== "1")("portal routes against PostgreSQL", () => {
  const config = loadAdminConfig({
    ...process.env,
    NODE_ENV: "test",
    ADMIN_PUBLIC_URL: "http://localhost:3100",
    OIDC_ISSUER: "http://localhost:3000",
    ADMIN_CLIENT_ID: "vitest-portal",
    ADMIN_COOKIE_KEYS: "a".repeat(40) + "," + "b".repeat(40),
  });
  const { db, pool } = createDatabase(config.databaseUrl);
  const app = createAdminApp(config, db).app;

  let adminCookie = "";
  let csrf = "";
  const createdIds: string[] = [];

  async function makeUser(tag: string, permissions: string[] = [], local = true) {
    const id = crypto.randomUUID();
    const email = ("vitest-" + tag + "-" + id.slice(0, 8) + "@example.test").toLowerCase();
    await db.insert(users).values({
      id,
      provider: local ? "local" : "basischina-microsoft",
      upstreamIssuer: local ? "local" : "https://login.microsoftonline.com/vitest",
      upstreamSubject: id,
      email,
      emailVerified: !local,
      displayName: "Vitest " + tag,
    });
    if (local) {
      await db.insert(localCredentials).values({ userId: id, passwordHash: "scrypt:x:y", mustResetPassword: true });
    }
    for (const permission of permissions) {
      await db.insert(userPermissions).values({ userId: id, permission }).onConflictDoNothing();
    }
    createdIds.push(id);
    return { id, email };
  }

  beforeAll(async () => {
    const admin = await makeUser("admin", [
      "portal.admins.manage", "portal.users.read", "portal.users.write",
      "portal.clients.read", "portal.clients.write", "portal.resources.write",
      "portal.tokens.revoke", "portal.consents.revoke", "portal.audit.read",
      "portal.signins.read", "portal.privileged.read", "portal.settings.write",
    ]);
    const rawToken = crypto.randomUUID() + crypto.randomUUID();
    const { hashToken } = await import("../../../src/oauth/crypto.js");
    await db.execute(sql`insert into admin_sessions (id_hash, user_id, auth_time, expires_at) values (${hashToken(rawToken)}, ${admin.id}, now(), now() + interval '8 hours')`);
    adminCookie = "basis_admin_session=" + rawToken;
    const meResponse = await app.request("/api/me", { headers: { Cookie: adminCookie } });
    csrf = (await meResponse.json()).csrfToken;
  });

  afterAll(async () => {
    for (const id of createdIds.splice(0)) {
      await db.delete(users).where(eq(users.id, id));
    }
    await setLocked(db, false).catch(() => undefined);
    await pool.end();
  });

  function mutate(path: string, options: { method?: string; body?: unknown } = {}) {
    return app.request(path, {
      method: options.method ?? "POST",
      headers: {
        Cookie: adminCookie,
        "Content-Type": "application/json",
        "x-csrf-token": csrf,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  }

  it("rejects anonymous access to guarded routes", async () => {
    const paths = ["/api/users", "/api/sessions", "/api/tokens", "/api/dashboard/summary", "/api/roles/admins", "/api/settings/lockout"];
    for (const path of paths) {
      const response = await app.request(path);
      expect(response.status, path).toBe(401);
    }
  });

  it("lists users with pagination metadata", async () => {
    await makeUser("list");
    const response = await app.request("/api/users", { headers: { Cookie: adminCookie } });
    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(Array.isArray(body.users)).toBe(true);
    expect("nextCursor" in body).toBe(true);
  });

  it("shows user detail including permissions", async () => {
    const user = await makeUser("detail", ["portal.users.read"]);
    const response = await app.request("/api/users/" + user.id, { headers: { Cookie: adminCookie } });
    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(body.user.email).toBe(user.email);
    expect(body.user.permissions).toContain("portal.users.read");
    expect(body.user.privileged).toBe(true);
  });

  it("404s unknown user detail", async () => {
    const response = await app.request("/api/users/00000000-0000-4000-8000-000000000000", { headers: { Cookie: adminCookie } });
    expect(response.status).toBe(404);
  });

  it("replaces portal permissions persistently", async () => {
    const user = await makeUser("perm");
    const response = await mutate("/api/users/" + user.id + "/permissions", { method: "PUT", body: { permissions: ["portal.audit.read"] } });
    expect(response.status).toBe(200);
    const account = await loadPortalAccount(db, user.id);
    expect(account?.permissions).toContain("portal.audit.read");
  });

  it("blocks self-permission edits with self_edit", async () => {
    const admins = await db.execute(sql`select u.id from users u join user_permissions p on p.user_id = u.id where p.permission = 'portal.admins.manage' limit 1`);
    const selfId = String((admins.rows[0] as any).id);
    const response = await mutate("/api/users/" + selfId + "/permissions", { method: "PUT", body: { permissions: [] } });
    expect(response.status).toBe(403);
    expect(((await response.json()) as any).error).toBe("self_edit");
  });

  it("allows demoting a second manage-holder while one remains", async () => {
    const second = await makeUser("second-manager", ["portal.admins.manage"]);
    const response = await mutate("/api/users/" + second.id + "/permissions", { method: "PUT", body: { permissions: ["portal.users.read"] } });
    expect(response.status).toBe(200);
    const account = await loadPortalAccount(db, second.id);
    expect(account?.permissions).not.toContain("portal.admins.manage");
  });

  it("disables then re-enables accounts", async () => {
    const user = await makeUser("toggle");
    const disable = await mutate("/api/users/" + user.id + "/disable", {});
    expect(disable.status).toBe(200);
    expect((await loadPortalAccount(db, user.id))?.disabled).toBe(true);
    const enable = await mutate("/api/users/" + user.id + "/enable", {});
    expect(enable.status).toBe(200);
    expect((await loadPortalAccount(db, user.id))?.disabled).toBe(false);
  });

  it("creates local users with show-once credentials", async () => {
    const email = ("vitest-created-" + crypto.randomUUID().slice(0, 8) + "@example.test").toLowerCase();
    const response = await mutate("/api/users/local", { body: { email, displayName: "Created User" } });
    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(body.tempPassword.length).toBeGreaterThanOrEqual(12);
    const [creds] = await db.select().from(localCredentials).where(eq(localCredentials.userId, body.userId));
    expect(creds?.mustResetPassword).toBe(true);
  });

  it("returns 409 for duplicate emails on creation", async () => {
    const user = await makeUser("dupe");
    const response = await mutate("/api/users/local", { body: { email: user.email, displayName: "Dup" } });
    expect(response.status).toBe(409);
  });

  it("resets local credentials to a fresh temporary password", async () => {
    const user = await makeUser("reset");
    const response = await mutate("/api/users/" + user.id + "/credentials/reset", {});
    expect(response.status).toBe(200);
    expect(((await response.json()) as any).tempPassword).toBeTruthy();
  });

  it("removes MFA factors without touching passwords", async () => {
    const user = await makeUser("mfa");
    await db.update(localCredentials).set({ totpConfirmedAt: new Date(), recoveryCodes: ["hash"] }).where(eq(localCredentials.userId, user.id));
    const response = await mutate("/api/users/" + user.id + "/mfa/reset", {});
    expect(response.status).toBe(200);
    const [creds] = await db.select().from(localCredentials).where(eq(localCredentials.userId, user.id));
    expect(creds?.totpConfirmedAt).toBeNull();
    expect(creds?.passwordHash).toBe("scrypt:x:y");
  });

  it("deletes users permanently", async () => {
    const user = await makeUser("gone");
    const response = await app.request("/api/users/" + user.id, { method: "DELETE", headers: { Cookie: adminCookie, "x-csrf-token": csrf } });
    expect(response.status).toBe(200);
    expect(await loadPortalAccount(db, user.id)).toBeUndefined();
    const index = createdIds.indexOf(user.id);
    if (index >= 0) createdIds.splice(index, 1);
  });

  it("force-signs-out accounts and clears sessions", async () => {
    const user = await makeUser("signout");
    await db.insert(authSessions).values({
      idHash: "vitest-" + crypto.randomUUID(),
      userId: user.id,
      authenticatedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const response = await mutate("/api/users/" + user.id + "/force-signout", {});
    expect(response.status).toBe(200);
    const remaining = await db.select().from(authSessions).where(eq(authSessions.userId, user.id));
    expect(remaining.length).toBe(0);
  });

  it("registers confidential applications with an initial secret", async () => {
    const resource = "urn:basis:vitest";
    await mutate("/resources/" + encodeURIComponent(resource), { method: "PUT", body: { scopes: [] } });
    const response = await mutate("/api/clients", { body: {
      name: "Vitest App",
      redirectUris: ["https://app.example.test/callback"],
      public: false,
      scopes: ["openid"],
      resources: [resource],
      requireConsent: false,
      filterMode: null,
      filterContent: [],
    } });
    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(typeof body.secret).toBe("string");
    const detail = await app.request("/api/clients/" + body.clientId, { headers: { Cookie: adminCookie } });
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as any).secrets.length).toBeGreaterThan(0);
    await app.request("/api/clients/" + body.clientId, { method: "DELETE", headers: { Cookie: adminCookie, "x-csrf-token": csrf } });
  });

  it("serves monitoring lists", async () => {
    for (const path of ["/api/sessions", "/api/tokens", "/api/audit", "/api/signins", "/api/roles/admins"]) {
      const response = await app.request(path, { headers: { Cookie: adminCookie } });
      expect(response.status, path).toBe(200);
    }
  });

  it("aggregates dashboard counters", async () => {
    const response = await app.request("/api/dashboard/summary", { headers: { Cookie: adminCookie } });
    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(body.counters.activeUsers).toBeGreaterThan(0);
  });

  it("reads and toggles the lockout switch", async () => {
    const read = await app.request("/api/settings/lockout", { headers: { Cookie: adminCookie } });
    expect(read.status).toBe(200);
    const toggle = await mutate("/api/settings/lockout", { method: "PUT", body: { locked: false, confirm: "LOCK" } });
    expect(toggle.status).toBe(200);
    expect(((await toggle.json()) as any).locked).toBe(false);
  });

  it("adopts pending stubs on upstream sign-in keeping grants", async () => {
    const identity = createIdentityService(db, "participant", []);
    const stubId = crypto.randomUUID();
    const email = ("vitest-adopt-" + stubId.slice(0, 8) + "@example.test").toUpperCase();
    await db.insert(users).values({
      id: stubId, provider: "local", upstreamIssuer: "pending", upstreamSubject: stubId,
      email, emailVerified: false,
    });
    createdIds.push(stubId);
    await db.insert(userPermissions).values({ userId: stubId, permission: "portal.privileged.read" });
    const signedIn = await identity.upsertFromMicrosoft({
      provider: "basischina-microsoft",
      issuer: "https://login.microsoftonline.com/vitest-adoption",
      subject: crypto.randomUUID(),
      email,
      emailVerified: true,
    });
    expect(signedIn.id).toBe(stubId);
    const account = await loadPortalAccount(db, stubId);
    expect(account?.permissions).toContain("portal.privileged.read");
  });

  it("rejects upstream sign-ins colliding with verified emails", async () => {
    const identity = createIdentityService(db, "participant", []);
    const realLocal = await makeUser("reallocal");
    await db.update(users).set({ emailVerified: true }).where(eq(users.id, realLocal.id));
    await expect(identity.upsertFromMicrosoft({
      provider: "basischina-microsoft",
      issuer: "https://login.microsoftonline.com/vitest-adoption",
      subject: crypto.randomUUID(),
      email: realLocal.email.toUpperCase(),
      emailVerified: true,
    })).rejects.toThrow();
  });

  it("purges expired artifacts in bounded batches", async () => {
    const result = await createPurgeService(db).purgeExpired(5000);
    expect(result.authSessions).toBeGreaterThanOrEqual(0);
  });

  it("round-trips the lockout flag", async () => {
    await setLocked(db, false);
    expect(await isLocked(db)).toBe(false);
    await setLocked(db, true);
    expect(await isLocked(db)).toBe(true);
    await setLocked(db, false);
  });
});
