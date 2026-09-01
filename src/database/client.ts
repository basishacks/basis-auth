import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export function createDatabase(databaseUrl: string) {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.DATABASE_POOL_MAX) || 10,
    idleTimeoutMillis: Number(process.env.DATABASE_POOL_IDLE_TIMEOUT_MS) || 10_000,
    connectionTimeoutMillis: Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS) || 5_000,
    allowExitOnIdle: process.env.NODE_ENV === "production",
    ...(process.env.DATABASE_STATEMENT_TIMEOUT_MS
      ? { options: `-c statement_timeout=${process.env.DATABASE_STATEMENT_TIMEOUT_MS}` }
      : {}),
  });
  return {
    pool,
    db: drizzle({ client: pool }),
  };
}

export type Database = ReturnType<typeof createDatabase>["db"];
