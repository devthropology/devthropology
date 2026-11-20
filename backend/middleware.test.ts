import { Hono } from "hono";
import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { describe, it } from "vitest";
import { AuthUser } from "./models/auth.ts";
import { AuthorizationService } from "./authorizationService.ts";
import { createAuthMiddleware, createAuthzMiddleware } from "./middleware.ts";

describe("createAuthMiddleware", () => {
  for (const { name, error, expectedStatus } of [
    { name: "invalid token", error: null, expectedStatus: 401 },
    {
      name: "connection refused",
      error: { code: "ECONNREFUSED" },
      expectedStatus: 503,
    },
    {
      name: "unexpected validation failure",
      error: new Error("internal"),
      expectedStatus: 500,
    },
  ]) {
    it(`distinguishes ${name}`, async () => {
      const app = new Hono();
      app.use(
        "*",
        createAuthMiddleware({
          validateToken: () =>
            error ? Promise.reject(error) : Promise.resolve(null),
        }),
      );
      app.get("/private", (c) => c.text("must not run"));
      const response = await app.request("/private", {
        headers: { Authorization: "Bearer test-token" },
      });
      assertEquals(response.status, expectedStatus);
      assertEquals((await response.text()).includes("test-token"), false);
    });
  }

  it("leaves downstream errors to the application error handler", async () => {
    const app = new Hono();
    app.use(
      "*",
      createAuthMiddleware({
        validateToken: () =>
          Promise.resolve({ userId: "id", username: "user", role: "user" }),
      }),
    );
    app.get("/private", () => {
      throw new Error("downstream");
    });
    app.onError((_error, c) => c.json({ error: "downstream handled" }, 502));
    const response = await app.request("/private", {
      headers: { Authorization: "Bearer test-token" },
    });
    assertEquals(response.status, 502);
    assertEquals(await response.json(), { error: "downstream handled" });
  });
});

describe("createAuthzMiddleware", () => {
  it("returns 503 when repository authorization cannot reach the database", async () => {
    const transientError = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
    const authzService = {
      canAccessRepositoryById: () => Promise.reject(transientError),
    } as unknown as AuthorizationService;
    const app = new Hono<{ Variables: { user: AuthUser } }>();
    const authzMiddleware = createAuthzMiddleware(authzService);
    const user: AuthUser = {
      userId: "user-123",
      username: "user@example.com",
      role: "user",
    };

    app.use("/api/repository/:repositoryId", async (c, next) => {
      c.set("user", user);
      return await authzMiddleware(c, next);
    });
    app.get("/api/repository/:repositoryId", (c) => c.text("ok"));

    const response = await app.request("/api/repository/1");

    assertEquals(response.status, 503);
    assertEquals(await response.json(), {
      error: "Database temporarily unavailable",
    });
  });
});
