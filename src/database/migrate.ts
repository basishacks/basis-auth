import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "./client.js";

export async function migrateDatabase(databaseUrl: string) {
  const { db, pool } = createDatabase(databaseUrl);
  try {
    await migrate(db, { migrationsFolder: "drizzle" });
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  await migrateDatabase(databaseUrl);
}
