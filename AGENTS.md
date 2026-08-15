# Repository Guidelines

## Project Structure & Module Organization

- `src/` contains the Hono/OIDC service. `app.ts` defines HTTP routes, `oauth/` contains protocol and token logic, `database/` contains Drizzle schema, migrations, and seeding, and `microsoft.ts` implements the upstream login flow.
- `web/` is the React/Vite interaction UI. Put application components in `web/src/components/`, reusable UI primitives in `web/src/components/ui/`, and browser-facing helpers in `web/src/lib/`.
- `drizzle/` holds generated SQL migrations and metadata. Do not edit historical migrations; generate a new one after schema changes.
- `scripts/` contains maintenance CLIs. `examples/` contains downstream integration examples.

## Build, Test, and Development Commands

- `npm run dev` builds the UI, watches the backend, and watches UI builds.
- `npm run dev:web` runs Vite’s development server for UI work.
- `npm run typecheck` checks both server and web TypeScript projects.
- `npm run build` creates the production web build and compiles server code to `dist/`.
- `npm test` runs the Vitest suite; target a file with `npx vitest run src/app.test.ts`.
- `npm run db:generate` creates a Drizzle migration after changing `src/database/schema.ts`; use `npm run db:migrate` to apply migrations with `DATABASE_URL` set.

## Coding Style & Naming Conventions

Use TypeScript with ESM imports and match the formatting of the surrounding file (server code generally uses two spaces; UI components currently use their local style). Use `camelCase` for functions and values, `PascalCase` for React components and exported types, and kebab-case filenames such as `scope-description.ts`. Keep route handlers focused; place OAuth or persistence rules in their respective service modules. Use existing shadcn-style primitives before adding new UI patterns.

## Testing Guidelines

Use Vitest for unit and route tests. Name tests as behavior statements, for example `it("redirects browser logout requests to the original authorization URL", ...)`. Add or update tests for authorization, token, identity, configuration, and migration-affecting behavior. PostgreSQL integration tests require Docker and `RUN_POSTGRES_TESTS=1`.

## Commit & Pull Request Guidelines

Use concise, imperative Conventional Commit-style subjects, e.g. `feat: add client filtering` or `fix: preserve authorize query`. Keep commits scoped. Pull requests should explain the behavioral change, list validation commands, mention migrations or configuration changes, and include screenshots for visible UI changes.

## Security & Configuration

Never commit `.env`, credentials, private JWKs, tokens, or database dumps. Start from `.env.example`. Keep `OIDC_ISSUER`, the running port, and Microsoft redirect URI aligned. Treat OAuth redirect, session, consent, and token changes as security-sensitive and verify their failure paths.
