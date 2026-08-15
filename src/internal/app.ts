import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { InternalUserError, type InternalUserService } from "./users.js";

export function createInternalApp(token: string, users: InternalUserService) {
  const app = new Hono();
  app.use("*", secureHeaders());
  app.use("*", async (c, next) => {
    const supplied = c.req.header("authorization")?.match(/^Bearer ([^\s]+)$/)?.[1];
    if (!supplied) return c.json({ error: "unauthorized" }, 401);
    const suppliedBytes = Buffer.from(supplied);
    const expectedBytes = Buffer.from(token);
    if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    c.header("Cache-Control", "no-store");
    await next();
  });

  app.get("/internal/users/:userId", async (c) => {
    try {
      const user = await users.findUser(c.req.param("userId"));
      return user ? c.json({ user }) : c.json({ error: "user_not_found" }, 404);
    } catch (error) {
      if (error instanceof InternalUserError) {
        return c.json({ error: error.code, message: error.message }, error.status);
      }
      throw error;
    }
  });

  app.get("/internal/users/:userId/picture", async (c) => {
    try {
      const picture = await users.findPicture(c.req.param("userId"));
      if (!picture?.data || !picture.contentType) return c.json({ error: "picture_not_found" }, 404);
      c.header("Content-Type", picture.contentType);
      return c.body(new Uint8Array(picture.data));
    } catch (error) {
      if (error instanceof InternalUserError) {
        return c.json({ error: error.code, message: error.message }, error.status);
      }
      throw error;
    }
  });

  app.patch("/internal/users/:userId", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_request", message: "Request body is not valid JSON" }, 400);
    }
    try {
      return c.json({ user: await users.patchUser(c.req.param("userId"), body) });
    } catch (error) {
      if (error instanceof InternalUserError) {
        return c.json({ error: error.code, message: error.message }, error.status);
      }
      throw error;
    }
  });

  return app;
}
