import { Context, Hono, Next } from "hono";
import { TrendsService } from "./trendsService.ts";

type Middleware = (c: Context, next: Next) => Promise<Response | void>;

type TrendsRouteDeps = {
  authAndAuthzMiddleware: Middleware;
  cacheMiddleware: Middleware;
  resolveRepositoryIdParam: (c: Context) => number | null;
  getTrendsService: () => TrendsService;
};

export function registerTrendsRoutes(app: Hono, deps: TrendsRouteDeps) {
  app.get(
    "/api/repository/:repositoryId/explore/trends",
    deps.authAndAuthzMiddleware,
    deps.cacheMiddleware,
    async (c: Context) => {
      try {
        const repositoryId = deps.resolveRepositoryIdParam(c);
        const url = new URL(c.req.url);
        const teamSlug = url.searchParams.get("team")?.trim() || undefined;

        if (repositoryId === null) {
          return c.json({ error: "Invalid repository ID" }, 400);
        }

        const insights = await deps
          .getTrendsService()
          .getInsights(repositoryId, teamSlug);
        return c.json(insights);
      } catch (error) {
        console.error("Error fetching trends insights:", error);
        return c.json({ error: "Failed to fetch trends insights" }, 500);
      }
    },
  );
}
