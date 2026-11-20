import { Hono } from "hono";
import { z } from "zod";
import {
  GithubLoginError,
  type GithubLoginService,
} from "./githubLoginService.ts";

const SecretSchema = z.string().regex(/^[a-f0-9]{64}$/);
const StartSchema = z.object({
  browserSecret: SecretSchema,
  redirectTo: z.string().max(2048).default("/app"),
});
const CallbackSchema = z.object({
  browserSecret: SecretSchema,
  state: SecretSchema,
  code: z.string().min(1).max(1024).optional(),
  error: z.string().min(1).max(256).optional(),
});

export function createGithubLoginRoutes(getService: () => GithubLoginService) {
  const routes = new Hono();
  routes.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    await next();
  });
  routes.onError((error, c) => {
    if (error instanceof GithubLoginError) {
      return c.json(
        { error: error.code },
        error.code === "not_configured" ? 503 : 400,
      );
    }
    // SQL errors can contain parameters; never send/log them on this path.
    console.error("GitHub login could not be completed");
    return c.json({ error: "unavailable" }, 503);
  });
  routes.post("/start", async (c) => {
    const parsed = StartSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
    return c.json(
      await getService().start(
        parsed.data.browserSecret,
        parsed.data.redirectTo,
      ),
    );
  });
  routes.post("/callback", async (c) => {
    const parsed = CallbackSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) return c.json({ error: "invalid_state" }, 400);
    return c.json(await getService().complete(parsed.data));
  });
  return routes;
}
