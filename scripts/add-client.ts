import "dotenv/config";
import { clientInputSchema, type ClientSeed } from "../src/config.js";
import { createDatabase } from "../src/database/client.js";
import { seedConfiguration } from "../src/database/seed.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const rawClient = process.argv[2];
if (!rawClient) {
  throw new Error(
    'Usage: npm run clients:add -- \'{"name":"Example","clientSecret":"...","redirectUris":["https://example.com/callback"],"public":false,"resources":["urn:example:api"]}\'',
  );
}

const input = clientInputSchema.parse(JSON.parse(rawClient));
const client: ClientSeed = { ...input, clientId: crypto.randomUUID() };
const { db, pool } = createDatabase(process.env.DATABASE_URL);

try {
  await seedConfiguration(db, [client], []);
  process.stdout.write(`${client.clientId}\n`);
} finally {
  await pool.end();
}
