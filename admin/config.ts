import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3100),
  ADMIN_PUBLIC_URL: z.url().transform((url) => url.replace(/\/$/, "")),
  ADMIN_DATABASE_URL: z.string().min(1),
  OIDC_ISSUER: z.url().transform((issuer) => issuer.replace(/\/$/, "")),
  ADMIN_CLIENT_ID: z.string().min(1),
  ADMIN_COOKIE_KEYS: z.string().min(32),
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  STEP_UP_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(300),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(8),
  ADMIN_IP_ALLOWLIST: z.string().optional(),
  ALERT_WEBHOOK_URL: z.url().optional(),
  // Required whenever ALERT_WEBHOOK_URL is set; signatures let the receiver
  // prove an alert genuinely came from this portal.
  ALERT_WEBHOOK_SECRET: z.string().min(32).optional(),
});

export interface AdminConfig {
  environment: "development" | "test" | "production";
  port: number;
  publicUrl: string;
  databaseUrl: string;
  issuer: string;
  clientId: string;
  cookieKeys: string[];
  trustProxy: boolean;
  stepUpMaxAgeSeconds: number;
  sessionTtlHours: number;
  ipAllowlist: string[];
  alertWebhook?: {
    url: string;
    secret: string;
  };
}

export function loadAdminConfig(source: NodeJS.ProcessEnv = process.env): AdminConfig {
  const env = environmentSchema.parse(source);
  const hasWebhookUrl = Boolean(env.ALERT_WEBHOOK_URL);
  if (hasWebhookUrl && !env.ALERT_WEBHOOK_SECRET) {
    throw new Error("ALERT_WEBHOOK_SECRET is required when ALERT_WEBHOOK_URL is set");
  }
  return {
    environment: env.NODE_ENV,
    port: env.PORT,
    publicUrl: env.ADMIN_PUBLIC_URL,
    databaseUrl: env.ADMIN_DATABASE_URL,
    issuer: env.OIDC_ISSUER,
    clientId: env.ADMIN_CLIENT_ID,
    cookieKeys: env.ADMIN_COOKIE_KEYS.split(",").map((key) => key.trim()),
    trustProxy: env.TRUST_PROXY,
    stepUpMaxAgeSeconds: env.STEP_UP_MAX_AGE_SECONDS,
    sessionTtlHours: env.SESSION_TTL_HOURS,
    ipAllowlist: (env.ADMIN_IP_ALLOWLIST ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
    alertWebhook:
      hasWebhookUrl && env.ALERT_WEBHOOK_SECRET
        ? { url: env.ALERT_WEBHOOK_URL!, secret: env.ALERT_WEBHOOK_SECRET }
        : undefined,
  };
}
