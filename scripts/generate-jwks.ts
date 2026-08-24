import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { exportJWK, generateKeyPair } from "jose";
import { randomToken } from "../src/oauth/crypto.js";

/**
 * One-shot developer bootstrap: creates .env from .env.example when needed
 * and fills every generated secret IN PLACE, so nothing is ever copied by
 * hand. Safe to re-run: real values are never overwritten, only empty
 * placeholders are replaced.
 */
const ENV_PATH = ".env";
const EXAMPLE_PATH = ".env.example";

if (!existsSync(ENV_PATH)) {
  if (!existsSync(EXAMPLE_PATH)) {
    throw new Error(`Neither ${ENV_PATH} nor ${EXAMPLE_PATH} exists`);
  }
  await writeFile(ENV_PATH, await readFile(EXAMPLE_PATH, "utf8"));
  console.log(`Created ${ENV_PATH} from ${EXAMPLE_PATH}`);
}

const original = await readFile(ENV_PATH, "utf8");
const lines = original.split(/\r?\n/);
const changes: string[] = [];

function currentValue(key: string): string | undefined {
  const prefix = `${key}=`;
  const line = lines.find((candidate) => candidate.startsWith(prefix));
  return line?.slice(prefix.length).trim();
}

function isPlaceholder(value: string | undefined): boolean {
  if (value === undefined) return true;
  const trimmed = value.trim();
  return trimmed === "" || trimmed.toLowerCase().startsWith("replace-with");
}

/** Replaces KEY=value only while it is still an unfilled placeholder. */
function fill(key: string, value: string): boolean {
  const index = lines.findIndex((candidate) => candidate.startsWith(`${key}=`));
  if (index === -1) {
    lines.push(`${key}=${value}`);
  } else if (!isPlaceholder(currentValue(key))) {
    return false;
  } else {
    lines[index] = `${key}=${value}`;
  }
  changes.push(key);
  return true;
}

/** Unconditional replacement for values this script owns idempotently. */
function setValue(key: string, value: string) {
  const index = lines.findIndex((candidate) => candidate.startsWith(`${key}=`));
  if (index === -1) {
    lines.push(`${key}=${value}`);
  } else {
    lines[index] = `${key}=${value}`;
  }
  changes.push(key);
}

// --- Random secrets -------------------------------------------------------

fill("INTERNAL_API_TOKEN", randomToken(36));

if (isPlaceholder(currentValue("OIDC_COOKIE_KEYS"))) {
  fill("OIDC_COOKIE_KEYS", `${randomToken(32)},${randomToken(32)}`);
}
if (isPlaceholder(currentValue("ADMIN_COOKIE_KEYS"))) {
  fill("ADMIN_COOKIE_KEYS", `${randomToken(32)},${randomToken(32)}`);
}

// --- Signing key ----------------------------------------------------------

async function generateSigningJwk(): Promise<string> {
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(privateKey);
  jwk.use = "sig";
  jwk.alg = "RS256";
  jwk.kid = crypto.randomUUID();
  return JSON.stringify({ keys: [jwk] });
}

if (!currentValue("OIDC_JWKS_FILE")) {
  const existing = currentValue("OIDC_JWKS_JSON");
  if (existing === undefined || existing.trim() === "") {
    fill("OIDC_JWKS_JSON", await generateSigningJwk());
  }
}

// --- Management portal registration --------------------------------------

const adminPublicUrl = (currentValue("ADMIN_PUBLIC_URL") ?? "").trim() || "http://localhost:3100";
const adminRedirectUri = `${adminPublicUrl.replace(/\/$/, "")}/auth/callback`;

let adminClientId = currentValue("ADMIN_CLIENT_ID");
if (isPlaceholder(adminClientId)) {
  adminClientId = crypto.randomUUID();
  fill("ADMIN_CLIENT_ID", adminClientId!);
}

let resourcesChanged = false;
let resources: Array<Record<string, unknown>> = [];
try {
  resources = JSON.parse(currentValue("OIDC_RESOURCES_JSON") ?? "[]");
} catch {
  console.error("OIDC_RESOURCES_JSON is not valid JSON; leaving it untouched");
}
const portalResource = "urn:basis:admin";
if (Array.isArray(resources) && !resources.some((entry) => entry?.audience === portalResource)) {
  resources.push({ audience: portalResource, scopes: [] });
  setValue("OIDC_RESOURCES_JSON", JSON.stringify(resources));
  resourcesChanged = true;
}

let clientsChanged = false;
let clients: Array<Record<string, unknown>> = [];
try {
  clients = JSON.parse(currentValue("OIDC_CLIENTS_JSON") ?? "[]");
} catch {
  console.error("OIDC_CLIENTS_JSON is not valid JSON; leaving it untouched");
}
if (
  Array.isArray(clients) &&
  adminClientId &&
  !clients.some((entry) => entry?.clientId === adminClientId || entry?.name === "Basis Admin")
) {
  clients.push({
    clientId: adminClientId,
    name: "Basis Admin",
    public: true,
    redirectUris: [adminRedirectUri],
    scopes: ["openid", "profile", "email", "permissions"],
    resources: [portalResource],
    requireConsent: false,
    filterMode: null,
    filterContent: [],
  });
  setValue("OIDC_CLIENTS_JSON", JSON.stringify(clients));
  clientsChanged = true;
}

await writeFile(ENV_PATH, lines.join("\n"));

if (changes.length === 0) {
  console.log(`No placeholders left to fill; ${ENV_PATH} is already complete.`);
} else {
  console.log(`Updated ${changes.length} value(s) in ${ENV_PATH}:`);
  for (const key of changes) console.log(`  - ${key}`);
}
if (clientsChanged || resourcesChanged) {
  console.log("Portal registered inside OIDC_CLIENTS_JSON / OIDC_RESOURCES_JSON.");
}
console.log("Next: configure DATABASE_URL, MICROSOFT_*, then run npm run dev.");
