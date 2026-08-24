import { describe, expect, it } from "vitest";
import { loadAdminConfig } from "./config.js";

const base = {
  NODE_ENV: "test",
  ADMIN_PUBLIC_URL: "http://localhost:3100",
  ADMIN_DATABASE_URL: "postgresql://basis_admin:x@localhost:5432/basis_auth",
  OIDC_ISSUER: "http://localhost:3000",
  ADMIN_CLIENT_ID: "portal-client",
  ADMIN_COOKIE_KEYS: `${"a".repeat(40)},${"b".repeat(40)}`,
};

describe("admin config", () => {
  it("treats blank dotenv values as unset optional settings", () => {
    const config = loadAdminConfig({
      ...base,
      ALERT_WEBHOOK_URL: "",
      ALERT_WEBHOOK_SECRET: "",
      ADMIN_IP_ALLOWLIST: "",
    });
    expect(config.alertWebhook).toBeUndefined();
    expect(config.ipAllowlist).toEqual([]);
  });

  it("rejects a webhook URL without its signing secret", () => {
    expect(() =>
      loadAdminConfig({ ...base, ALERT_WEBHOOK_URL: "https://hooks.example.test/x", ALERT_WEBHOOK_SECRET: "" }),
    ).toThrow(/ALERT_WEBHOOK_SECRET/);
  });

  it("accepts a fully configured alert webhook", () => {
    const config = loadAdminConfig({
      ...base,
      ALERT_WEBHOOK_URL: "https://hooks.example.test/x",
      ALERT_WEBHOOK_SECRET: "s".repeat(40),
    });
    expect(config.alertWebhook?.url).toBe("https://hooks.example.test/x");
  });

  it("normalizes trailing slashes off public URLs", () => {
    const config = loadAdminConfig({ ...base, ADMIN_PUBLIC_URL: "http://localhost:3100/" });
    expect(config.publicUrl).toBe("http://localhost:3100");
  });
});
