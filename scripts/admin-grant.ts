import "dotenv/config";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { userPermissions, users } from "../src/database/schema.js";
import { isPortalPermission } from "../admin/api/permissions.js";

/**
 * Grants a portal permission to an existing account by email. This is the
 * break-glass path for bootstrapping the first administrator; afterwards,
 * grants are managed inside the portal itself.
 *
 * Usage: npm run admin:grant -- <email> [permission]
 * Permission defaults to portal.admins.manage.
 */
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const email = process.argv[2]?.trim().toLowerCase();
const permission = process.argv[3]?.trim() ?? "portal.admins.manage";
if (!email) {
  throw new Error("Usage: npm run admin:grant -- <email> [permission]");
}
if (!isPortalPermission(permission)) {
  throw new Error(`Unknown portal permission "${permission}". Valid: see admin/api/permissions.ts`);
}

const { db, pool } = createDatabase(process.env.DATABASE_URL);
try {
  const [user] = await db
    .select({ id: users.id, disabled: users.disabled })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user) {
    // Bootstrap convenience: create an unverified placeholder account bound
    // to this email. The first Microsoft sign-in claiming that email adopts
    // the stub (see identity.upsertFromMicrosoft), keeping the grant intact.
    const userId = crypto.randomUUID();
    await db.insert(users).values({
      id: userId,
      provider: "local",
      upstreamIssuer: "pending",
      upstreamSubject: userId,
      email,
      emailVerified: false,
      displayName: null,
    });
    await db.insert(userPermissions).values({ userId, permission }).onConflictDoNothing();
    console.log(`Created pending account for ${email} and granted ${permission}.`);
    console.log("It will be claimed automatically on the first Microsoft sign-in with that email.");
  } else {
    await db
      .insert(userPermissions)
      .values({ userId: user.id, permission })
      .onConflictDoNothing();
    if (user.disabled) console.warn("Note: this account is currently disabled.");
    console.log(`Granted ${permission} to ${email}.`);
  }
} finally {
  await pool.end();
}
