import "dotenv/config";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createDatabase } from "../src/database/client.js";
import { oidcClients } from "../src/database/schema.js";

const rawClientId = process.argv[2];
if (!rawClientId) throw new Error("Usage: bun run clients:remove -- <client-uuid>");
const clientId = z.uuid().parse(rawClientId);
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const { db, pool } = createDatabase(process.env.DATABASE_URL);

try {
  const removed = await db
    .delete(oidcClients)
    .where(eq(oidcClients.clientId, clientId))
    .returning({ clientId: oidcClients.clientId });
  if (!removed.length) throw new Error(`Client ${clientId} does not exist`);
  process.stdout.write(`${removed[0]!.clientId}\n`);
} finally {
  await pool.end();
}
