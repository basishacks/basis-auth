import "dotenv/config";
import { readFile } from "node:fs/promises";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { loadAdminConfig } from "./config.js";
import { createDatabase } from "../src/database/client.js";
import { createAdminApp } from "./api/app.js";
import type { AppEnv } from "./api/middleware.js";

const config = loadAdminConfig();
const { db, pool } = createDatabase(config.databaseUrl);
const { app: adminApi, sessionCookieName } = createAdminApp(config, db);
void sessionCookieName;

const root = new Hono<{ Bindings: Record<string, string>; Variables: AppEnv["Variables"] }>();
root.route("/", adminApi);

if (config.environment !== "test") {
  root.use("/assets/*", serveStatic({ root: "./admin/dist" }));
  // SPA fallback: any non-API GET renders the portal shell.
  root.get("*", async (c) => {
    if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/auth/")) {
      return c.notFound();
    }
    try {
      return c.html(await readFile("./admin/dist/index.html", "utf8"));
    } catch {
      return c.text("Portal interface is not built yet. Run npm run build:web:admin.", 503);
    }
  });
}

const server = serve({ fetch: root.fetch, port: config.port }, () => {
  console.log(`basis-admin listening on ${config.publicUrl} (port ${config.port})`);
});

async function shutdown(signal: string) {
  console.log(`Received ${signal}; shutting down`);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
