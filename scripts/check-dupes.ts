import "dotenv/config";
import { sql } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";

// Reports duplicate normalized emails before the unique index migration runs.
// The migration fails loudly when duplicates exist; resolve them first.
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const { pool } = createDatabase(process.env.DATABASE_URL);

try {
  const result = await pool.query<{ email: string; count: string; ids: string }>(`
    select lower(email) as email, count(*)::text as count, string_agg(id::text, ', ') as ids
    from users
    group by lower(email)
    having count(*) > 1
    order by count desc
  `);
  if (result.rows.length === 0) {
    console.log("No duplicate emails found. The unique email migration is safe to run.");
  } else {
    console.error(`Found ${result.rows.length} duplicated address(es):`);
    for (const row of result.rows) {
      console.error(`  ${row.email} x${row.count} [users: ${row.ids}]`);
    }
    console.error("Merge or disable these accounts before running migrations.");
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
