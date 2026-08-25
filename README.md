# basis-auth

`basis-auth` is the authentication and identity boundary for Basis applications. It delegates human login to Microsoft Entra ID and acts as an OpenID Connect Provider for separately deployed applications and resource APIs.

It intentionally does **not** host application resources or share browser sessions with downstream applications.

The implemented surface is intentionally small and is not presented as OpenID certification. Before an internet-facing production launch, run the OpenID Foundation conformance suite and obtain a focused security review of the authorization, redirect, refresh-rotation, and key-management paths.

## Architecture

- **Hono** serves health checks, Microsoft login/callback routes, and the React interaction UI.
- **First-party OAuth/OIDC services** implement the deliberately limited discovery, authorization, token, UserInfo, JWKS, revocation, and logout surface.
- **PostgreSQL** stores identities, permissions, clients, grants, sessions, codes, and refresh-token state.
- **React/Vite** provides the same-origin login and consent interface.
- **Management portal** (`admin/`) is a separate Hono process + SPA that administers users, applications, resources, sessions, consents, and audit history through the same database.

Protocol endpoints:

| Endpoint | Purpose |
| --- | --- |
| `/.well-known/openid-configuration` | OIDC discovery |
| `/.well-known/oauth-authorization-server` | OAuth metadata |
| `/oauth/authorize` | Authorization code flow |
| `/oauth/token` | Code and refresh-token exchange |
| `/oauth/jwks` | RS256 public signing keys |
| `/oauth/userinfo` | OIDC identity claims |
| `/oauth/revoke` | Refresh-token revocation |
| `/oauth/logout` | OIDC/session logout |

Access tokens are ten-minute RS256 JWTs with `typ=at+jwt`. Their `aud` identifies the resource API, while `client_id` identifies the requesting application. Resource APIs validate them locally with the published JWKS.

## Database setup

Both processes connect to one PostgreSQL database:

- The IdP uses `DATABASE_URL`.
- The management portal uses `ADMIN_DATABASE_URL` and must connect through its own least-privilege role (see below).

### Option A — local development with Docker

Start a throwaway PostgreSQL 17 instance:

```bash
docker run -d --name basis-postgres \
  -e POSTGRES_USER=basis_auth \
  -e POSTGRES_PASSWORD=basis_auth \
  -e POSTGRES_DB=basis_auth \
  -p 5432:5432 postgres:17
```

Then point `.env` at it:

```text
DATABASE_URL=postgresql://basis_auth:basis_auth@localhost:5432/basis_auth
```

Migrations apply automatically at server startup; you can also run them manually:

```bash
npm run db:migrate
```

For the portal in development you can reuse the same credentials initially, but prefer creating the admin role right away so permissions behave exactly like production:

```bash
psql "postgresql://basis_auth:basis_auth@localhost:5432/basis_auth" \
  -v admin_password=basis_admin_dev \
  -f scripts/create-admin-role.sql
```

```text
ADMIN_DATABASE_URL=postgresql://basis_admin:basis_admin_dev@localhost:5432/basis_auth
```

### Option B — your own Linux server (systemd / bare metal)

1. Install PostgreSQL and initialize a cluster:

   ```bash
   sudo apt install postgresql
   sudo -u postgres psql -c "SELECT version();"   # sanity check
   ```

2. Create an application login role and the database. Use a long generated password; never reuse it elsewhere.

   ```bash
   sudo -u postgres psql
   ```

   ```sql
   CREATE ROLE basis_auth LOGIN PASSWORD 'replace-with-long-random-password';
   CREATE DATABASE basis_auth OWNER basis_auth;
   ```

3. Create the portal's least-privilege role inside that database. This role can read and mutate operational tables but has only SELECT + INSERT on `audit_events` and `auth_events`, so even a full portal compromise cannot rewrite history:

   ```bash
   psql "postgresql://basis_auth:<app-password>@localhost:5432/basis_auth" \
     -v admin_password='replace-with-another-long-password' \
     -f scripts/create-admin-role.sql
   ```

4. Apply migrations once before first start (startup also migrates automatically):

   ```bash
   DATABASE_URL=... npm run db:migrate
   ```

5. Listen only where needed. Default installs accept local connections, which fits a same-host deployment. If the database runs on a second host, restrict `listen_addresses`, allow only the app hosts' IPs in `pg_hba.conf`, and require TLS:

   ```text
   # pg_hba.conf (excerpt)
   hostssl basis_auth basis_auth 203.0.113.10/32 scram-sha-256
   ```

6. Wire the env vars and start under systemd (one unit per process):

   ```ini
   # /etc/basis/auth.env
   DATABASE_URL=postgresql://basis_auth:<password>@localhost:5432/basis_auth
   ADMIN_DATABASE_URL=postgresql://basis_admin:<password>@localhost:5432/basis_auth
   ```

7. Schedule backups. At minimum dump the cluster nightly and test restores:

   ```bash
   pg_dump --format=custom basis_auth > "/var/backups/basis_auth-$(date +%F).dump"
   ```

### Option C — managed PostgreSQL elsewhere

Any PostgreSQL 14+ service works (RDS, Cloud SQL, Azure Database, Neon, Supabase, Fly Postgres).

1. Create the database and note the connection string from the provider dashboard.
2. Append connection options as needed, for example `?sslmode=require` (managed providers generally require TLS).
3. Connect with the provider's admin credentials **once** to run `scripts/create-admin-role.sql` (RDS/Cloud SQL lack superusers; if `CREATE ROLE` fails due to extension or grant restrictions, create the role through the provider's user-management UI and apply just the GRANT statements from the script).
4. Run migrations from any machine that can reach the database:

   ```bash
   DATABASE_URL="postgresql://...?sslmode=require" npm run db:migrate
   ```

5. Keep both connection strings in your secret manager; never commit them.

Connection-string shape used everywhere:

```text
postgresql://<user>:<password>@<host>:<port>/<database>?sslmode=require
```

### Migration workflow

- Schema changes are Drizzle migrations checked into `drizzle/`; never edit historical files.
- After changing `src/database/schema.ts`: `npm run db:generate`, review the SQL, then `npm run db:migrate`.
- Migrations touching `users.email` uniqueness require a clean dataset: run `npm run db:check-dupes` first; it exits nonzero and lists offending accounts while duplicates exist.
- Startup always applies pending migrations idempotently, so a rolling deploy is safe.

## Local setup

Requirements: Node.js 24, npm, and PostgreSQL (Option A above is the easiest path).

```bash
cp .env.example .env
npm install
npm run setup
```

`npm run setup` fills every generated secret directly into `.env` — signing key, cookie keys, internal API token, and the management portal's client registration (ID plus its entries in `OIDC_CLIENTS_JSON`/`OIDC_RESOURCES_JSON`, with the redirect URI derived from `ADMIN_PUBLIC_URL`). It is idempotent: re-running only fills placeholders that are still empty, never overwriting values you set.

Configure Microsoft Entra next, then register this redirect URI in the Entra application:

```text
http://localhost:3000/oauth/callback/microsoft
```

Start the IdP:

```bash
npm run dev
```

Development serves the React build and OAuth endpoints from Hono at `http://localhost:3000`. `npm run dev` starts Hono plus a Vite build watcher; edits under `web/src/*` rebuild automatically, then reload the browser to see the change. Use `npm run dev:auth` when you only need the backend and `npm run dev:admin` for the portal.

The server applies checked-in Drizzle migrations and idempotently upserts configured clients and resource servers during startup. Removed configuration entries are not automatically deleted.

Production must set an HTTPS `OIDC_ISSUER`, persistent private JWKS, two or more strong cookie keys, Microsoft credentials, and a TLS-enabled PostgreSQL connection. For signing-key rotation, publish the new public key alongside the active key, deploy it everywhere, make it the first private key in the configured JWKS, and retain old public keys until all tokens they signed have expired.

## Environment variables

Core IdP variables live in `.env.example`; every hardening knob is documented there (`TRUST_PROXY`, `RATE_LIMIT_*`, `PURGE_INTERVAL_MS`, body limits). Portal-specific variables (`ADMIN_PUBLIC_URL`, `ADMIN_PORT`, `ADMIN_DATABASE_URL`, `ADMIN_CLIENT_ID`, `ADMIN_COOKIE_KEYS`, `STEP_UP_MAX_AGE_SECONDS`, `SESSION_TTL_HOURS`, `ADMIN_IP_ALLOWLIST`, `ALERT_WEBHOOK_*`) are documented in the same file under their own section.

## Client and resource registration

`OIDC_RESOURCES_JSON` declares API audiences and the scopes each API accepts. `OIDC_CLIENTS_JSON` declares which resources and scopes each application may request.

Confidential BFF clients use `client_secret_basic`; PostgreSQL stores only a scrypt hash of the configured secret. Public clients use `token_endpoint_auth_method=none`. Every authorization request from either client type must include a fresh RFC 7636 verifier-derived `code_challenge` and `code_challenge_method=S256`. The token request must include the matching `code_verifier`; `nonce` remains an additional OIDC replay binding and is not a substitute for PKCE.

A typical authorization request is:

```text
/oauth/authorize?
  client_id=basis-portal&
  response_type=code&
  redirect_uri=https%3A%2F%2Fportal.example.org%2Foauth%2Fcallback&
  scope=openid%20profile%20email%20permissions%20offline_access%20projects.read&
  resource=urn%3Abasis%3Aapi%3Aprojects&
  state=...&nonce=...&
  code_challenge=...&code_challenge_method=S256
```

`offline_access` is required for a refresh token. Refresh tokens expire after 30 days and rotate on every use. Consent is remembered by client and expanded scope set; clients configured with `requireConsent: false` silently approve their registered grants.

Each client can restrict Microsoft accounts with `filterMode` and `filterContent` in `OIDC_CLIENTS_JSON`. Set `filterMode` to `"whitelist"` to allow only the normalized Microsoft email/unique names in `filterContent`, or `"blacklist"` to reject those names. Leave the mode as `null` with an empty list to allow all accounts. Administrators can also set `users.disabled` to block an account across every client; blocked sign-ins return to the authorization page with an error.

To create a client directly in the database, pass its JSON definition without `clientId`; the command prints the generated UUID. Remove a client with that UUID. Removing a client cascades to its authorization data.
Remove a client from `OIDC_CLIENTS_JSON` before deleting it, otherwise the startup seed will create it again.

```bash
npm run clients:add -- '{"name":"Example","clientSecret":"replace-with-a-long-secret","redirectUris":["https://example.test/callback"],"public":false,"resources":["urn:basis:api:example"]}'
npm run clients:remove -- 3fa85f64-5717-4562-b3fc-2c963f66afa6
```

## Downstream BFF integration

Each downstream application owns its browser session. It must not forward, inspect, or share the `basis-auth` cookie.

1. Discover `basis-auth` from `/.well-known/openid-configuration`.
2. Store state, nonce, and a PKCE verifier in a short-lived server-side BFF session.
3. Redirect the browser to `/oauth/authorize`, including one registered `resource` audience.
4. Exchange the callback code from the BFF using `client_secret_basic` and the verifier, including the exact `redirect_uri` from step 3.
5. Validate the ID token, then create the application's own HTTP-only session cookie.
6. Encrypt the refresh token in the BFF's server-side session store.
7. Send only the access token as `Authorization: Bearer ...` to the resource API.
8. Refresh before access-token expiry; revoke the refresh token and delete the BFF session on logout.

ID tokens authenticate the client login. They must never be accepted by resource APIs. UserInfo may be used for intentional profile retrieval, not as per-request token validation.

## Resource API integration

[`examples/hono-resource-server`](./examples/hono-resource-server) contains reusable Hono middleware and a minimal API. The middleware:

- downloads and caches `/oauth/jwks`;
- allows only RS256 and `typ=at+jwt`;
- validates exact issuer, audience, and token lifetime;
- exposes `requireScopes()` and `requirePermissions()` helpers.

Other platforms should implement the same contract with their standard OAuth resource-server library. APIs that only verify JWTs locally observe user disablement and permission changes when existing access tokens expire, within ten minutes.

Resource APIs that require immediate per-user revocation must also load the token subject's `disabled` and `tokens_valid_after` state after signature validation. Reject disabled subjects and tokens whose `iat` is at or before that barrier. The example middleware exposes `loadTokenSubject` for this check while keeping JWT and revocation validation local to the resource API.

`basis-api` uses the private `/internal/users/:userId` endpoints for this state, profile pictures, and user PATCH operations. They run on a separate listener configured by `INTERNAL_API_HOST` and `INTERNAL_API_PORT`, bound to `127.0.0.1:3001` by default. Requests also require `Authorization: Bearer <INTERNAL_API_TOKEN>`. Use the same random token in trusted local services and keep the listener off the public network.

## Development commands

```bash
npm run typecheck
npm test
npm run build
npm run db:generate
npm run db:migrate
npm run db:check-dupes
```

PostgreSQL adapter integration tests are opt-in because they require Docker:

```bash
RUN_POSTGRES_TESTS=1 npm test
```

## API errors

These codes are NOT HTTP response codes.

| Code | Namespace | Description |
| --- | --- | --- |
| 400 | internal_error | General error such as invalid inputs |
| 14001 | invalid_client | Client is not registered or not found |
| 14002 | invalid_client | Client is disabled |
| 14003 | invalid_client | A public client attempts to send an application secret. PKCE is required for this mode |
| 14004 | invalid_client | Incorrect or unconfigured client secret |
| 14100 | invalid_request | redirect_uri is missing or not registered for the client |
| 14429 | unsupported_response_type | Unsupported response type |
| 14401 | invalid_scope | Client requests one or more scopes that are not configured or permitted |
| 14407 | unknown_resource | A selected resource of the client is not supported or not found |
| 14501 | invalid_target | One or more resources is not registered for this application |
| 2400 | invalid_request | Frontend authentication flow cookie not found or expired |
| 50040 | server_error | Internal server error occurred during login, such as a connection error with the Microsoft authentication endpoint |

## Management portal

A separate Entra-style administration portal lives in `admin/` and runs as its own process (`npm run dev:admin`, port `ADMIN_PORT`). Administrators sign in through this IdP itself (authorization code + PKCE) and are gated by the fixed `portal.*` permission catalog in `admin/api/permissions.ts`. Highlights:

- Least-privilege database role: run `scripts/create-admin-role.sql` once, then point `ADMIN_DATABASE_URL` at it. Audit and sign-in tables are append-only at the grant level.
- Step-up re-authentication (`prompt=login`) protects sensitive operations.
- Guardrails: no self-permission edits, last-admin protection, shielded privileged accounts behind `portal.privileged.read`.
- Signed webhook alerts for privilege changes (`ALERT_WEBHOOK_*`).
- Emergency lockout switch plus optional IP allowlist.

Provision the portal's own client through `OIDC_CLIENTS_JSON` (public client, PKCE, redirect `https://<portal-host>/auth/callback`) and set `ADMIN_CLIENT_ID` accordingly. Grant the first administrator after their first sign-in (the account row must exist):

```bash
npm run admin:grant -- your@email.example portal.admins.manage
```

Later grants and revocations happen in the portal itself and stick. If sign-in bounces back with `forbidden`, this command is the missing step.

## Security hardening

- Sliding-window rate limits on token, authorize, interaction, and callback routes; exponential per-client backoff after repeated auth failures.
- All user-controlled images are served with a sandboxing CSP so SVG logos and avatars can never execute script.
- Cookies use `__Host-` names in production with one-time re-login on upgrade.
- Client applications support multiple rotation secrets with overlap windows; plaintext secrets are displayed exactly once.
- Expired sessions, codes, requests, and revoked tokens are swept hourly in bounded batches (`PURGE_INTERVAL_MS`).
- Emails are case-insensitively unique (`db:check-dupes` reports conflicts before migrating).

Run `npm test` for the unit battery; PostgreSQL integration tests require Docker and `RUN_POSTGRES_TESTS=1`.

## Documentation site

The VitePress documentation lives in the docs/ submodule
([basishacks/basis-docs](https://github.com/basishacks/basis-docs)).

Clone with everything:

```bash
git clone --recurse-submodules git@github.com:basishacks/basis-auth.git    # SSH
git clone --recurse-submodules https://github.com/basishacks/basis-auth.git  # HTTPS
```

If you already cloned, fetch it once:

```bash
git submodule update --init docs
```

Both URLs work. The .gitmodules entry uses HTTPS so clones succeed anywhere;
SSH users can route through keys permanently with:

```bash
git config url."git@github.com:".insteadOf "https://github.com/"
```
