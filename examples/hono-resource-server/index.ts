import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { basisAuth, requirePermissions, requireScopes, type AuthVariables } from "./auth.js";

const issuer = process.env.BASIS_AUTH_ISSUER ?? "http://localhost:3000";
const audience = process.env.API_AUDIENCE ?? "urn:basis:api:example";
const app = new Hono<{ Variables: AuthVariables }>();

app.use("/api/*", basisAuth({ issuer, audience }));
app.get(
  "/api/projects",
  requireScopes("projects.read"),
  requirePermissions("participant"),
  (c) => c.json({ userId: c.get("basisToken").sub, projects: [] }),
);

serve({ fetch: app.fetch, port: 4000 });
