import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export interface DatabaseOptions {
  /** Maximum pooled connections. Size to (cores * 2) + spindle count at most. */
  max?: number;
  /** Idle connections close after this many milliseconds. */
  idleTimeoutMillis?: number;
  /** Connection attempts fail after this many milliseconds. */
  connectionTimeoutMillis?: number;
}

export function createDatabase(databaseUrl: string, options: DatabaseOptions = {}) {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: options.max ?? 10,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
  });
  // An unhandled 'error' event on an idle client would terminate the process.
  pool.on("error", (error) => {
    console.error("Idle PostgreSQL client error", error);
  });
  return {
    pool,
    db: drizzle({ client: pool }),
  };
}

export type Database = ReturnType<typeof createDatabase>["db"];
