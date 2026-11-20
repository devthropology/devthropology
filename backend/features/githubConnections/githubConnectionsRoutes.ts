import { Hono } from "hono";
import { z } from "zod";
import type { AuthUser } from "../../models/auth.ts";
import { ConnectionError } from "./githubConnectionsRepository.ts";
import {
  GithubConnectionsConfigurationError,
  type GithubConnectionsService,
} from "./githubConnectionsService.ts";

const CallbackSchema = z.object({
  state: z.string().regex(/^[a-f0-9]{64}$/),
  installationId: z
    .string()
    .regex(/^[1-9][0-9]{0,18}$/)
    .optional(),
  code: z.string().min(1).max(1024).optional(),
  setupAction: z.string().max(40).optional(),
});
// PostgreSQL accepts the non-RFC-versioned UUIDs used by seeded workspaces.
const ConnectionSchema = z.object({
  workspaceId: z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  installationId: z.string().regex(/^[1-9][0-9]{0,18}$/),
});
const AddSchema = ConnectionSchema.extend({
  repositoryIds: z.array(z.number().int().positive().safe()).min(1).max(100),
});

export function createGithubConnectionsRoutes(
  getService: () => GithubConnectionsService,
  onAdded: () => void,
) {
  const routes = new Hono<{ Variables: { user: AuthUser } }>();
  routes.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    await next();
  });
  routes.onError((error, c) => {
    // Never log error objects, provider payloads, SQL parameters, or request URLs.
    const databaseCode =
      "code" in error &&
      typeof error.code === "string" &&
      /^[0-9A-Z]{5}$/.test(error.code)
        ? error.code
        : undefined;
    console.error("[github-connections] request failed", {
      operation: c.req.path.split("/")[3],
      kind:
        error instanceof GithubConnectionsConfigurationError
          ? "configuration_error"
          : error instanceof ConnectionError
            ? "connection_error"
            : error instanceof z.ZodError
              ? "invalid_response"
              : "unexpected_error",
      databaseCode,
      ...(error instanceof z.ZodError
        ? {
            issues: error.issues.map((issue) => ({
              code: issue.code,
              path: issue.path.join("."),
            })),
          }
        : {}),
    });
    if (error instanceof GithubConnectionsConfigurationError) {
      return c.json({ error: error.message }, 503);
    }
    if (error instanceof ConnectionError) {
      return c.json({ error: error.message }, 400);
    }
    return c.json(
      {
        error: "Repository setup is unavailable. Please try again.",
      },
      503,
    );
  });
  routes.get("/workspaces", async (c) =>
    c.json(await getService().listWorkspaces(c.get("user"))),
  );
  routes.post("/start", async (c) => {
    const input = ConnectionSchema.partial({ installationId: true }).safeParse(
      await c.req.json().catch(() => null),
    );
    if (!input.success) return c.json({ error: "Select a workspace." }, 400);
    return c.json(
      await getService().start(
        c.get("user"),
        input.data.workspaceId,
        input.data.installationId,
      ),
    );
  });
  routes.post("/callback", async (c) => {
    const input = CallbackSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!input.success) {
      return c.json(
        {
          error: "Invalid callback. Please add repositories again.",
        },
        400,
      );
    }
    return c.json(await getService().callback(c.get("user"), input.data));
  });
  routes.get("/connections", async (c) =>
    c.json(await getService().listConnections(c.get("user"))),
  );
  routes.get("/repositories", async (c) => {
    const input = ConnectionSchema.safeParse(c.req.query());
    if (!input.success) {
      return c.json({ error: "Choose a connected GitHub account." }, 400);
    }
    return c.json(
      await getService().available(
        c.get("user"),
        input.data.workspaceId,
        input.data.installationId,
      ),
    );
  });
  routes.post("/repositories", async (c) => {
    const input = AddSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) {
      return c.json({ error: "Select between 1 and 100 repositories." }, 400);
    }
    const result = await getService().add(
      c.get("user"),
      input.data.workspaceId,
      input.data.installationId,
      input.data.repositoryIds,
    );
    onAdded();
    return c.json(result);
  });
  return routes;
}
