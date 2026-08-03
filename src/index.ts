import "dotenv/config";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./database/client.js";
import { migrateDatabase } from "./database/migrate.js";
import { seedConfiguration } from "./database/seed.js";
import { createIdentityService } from "./identity.js";
import { createMicrosoftService } from "./microsoft.js";
import { createKeyService } from "./oauth/keys.js";
import { createOAuthService } from "./oauth/service.js";
import { createSessionService } from "./oauth/sessions.js";

const config = await loadConfig();
await migrateDatabase(config.databaseUrl);
const { db, pool } = createDatabase(config.databaseUrl);
await seedConfiguration(db, config.clients, config.resources);
const identity = createIdentityService(
  db,
  config.defaultPermission,
  config.bootstrapPermissionGrants,
);
const keys = await createKeyService(config, identity);
const sessions = createSessionService(db);
const oauth = createOAuthService(config, db, keys, identity);
const microsoft = createMicrosoftService(config, db, identity);
const app = createApp(config, oauth, keys, sessions, microsoft);

const server = serve({ fetch: app.fetch, port: config.port }, () => {
  console.log(`basis-auth listening on ${config.issuer}`);
});

async function shutdown(signal: string) {
  console.log(`Received ${signal}; shutting down`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
