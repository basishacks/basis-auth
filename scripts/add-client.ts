import "dotenv/config";
import { clientInputSchema, type ClientSeed } from "../src/config.js";
import { createDatabase } from "../src/database/client.js";
import { seedConfiguration } from "../src/database/seed.js";

// const rawClient = process.argv[2];
// if (!rawClient) {
//   throw new Error('Usage: npm run clients:add -- \'{"name":"Example","clientSecret":"...","redirectUris":["https://example.com/callback"],"public":false,"resources":["urn:example:api"]}\'');
// }
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const rawClient = `
{
  "name": "DevConnect Portal",
  "clientSecret": "sk-fc8189fb63af8f0fdcc21a01b4b2f9c3d2ab7a4aba954aab103ba0bbe07717bc",
  "redirectUris": ["https://portal.bisz.dev/auth/callback"],
  "public": false,
  "resources": ["urn:basis:api"]
}
`

const input = clientInputSchema.parse(JSON.parse(rawClient));
const client: ClientSeed = { ...input, clientId: crypto.randomUUID() };
const { db, pool } = createDatabase(process.env.DATABASE_URL);

try {
  await seedConfiguration(db, [client], []);
  process.stdout.write(`${client.clientId}\n`);
} finally {
  await pool.end();
}
