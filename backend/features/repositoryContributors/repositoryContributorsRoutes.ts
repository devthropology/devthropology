import { Context, Hono, Next } from "hono";
import { RepositoryContributorsService } from "./repositoryContributorsService.ts";

type Middleware = (c: Context, next: Next) => Promise<Response | void>;

type RepositoryContributorsRouteDeps = {
  authAndAuthzMiddleware: Middleware;
  cacheMiddleware: Middleware;
  resolveRepositoryIdParam: (c: Context) => number | null;
  getRepositoryContributorsService: () => RepositoryContributorsService;
};

export function registerRepositoryContributorsRoutes(
  app: Hono,
  deps: RepositoryContributorsRouteDeps,
) {
  app.get(
    "/api/repository/:repositoryId/contributors/monthly",
    deps.authAndAuthzMiddleware,
    deps.cacheMiddleware,
    async (c: Context) => {
      try {
        const repositoryId = deps.resolveRepositoryIdParam(c);
        if (repositoryId === null) {
          return c.json({ error: "Invalid repository ID" }, 400);
        }

        const monthsParam = c.req.query("months");
        if (!monthsParam) {
          return c.json(
            {
              error:
                "months query parameter is required (positive integer or 'all')",
            },
            400,
          );
        }

        const months =
          monthsParam.toLowerCase() === "all"
            ? Number.MAX_SAFE_INTEGER
            : Number.parseInt(monthsParam, 10);

        if (!Number.isFinite(months) || months <= 0) {
          return c.json(
            { error: "months must be a positive integer or 'all'" },
            400,
          );
        }

        const response = await deps
          .getRepositoryContributorsService()
          .getMonthly(repositoryId, months);
        return c.json(response);
      } catch (error) {
        console.error("Error fetching monthly repository contributors:", error);
        return c.json(
          {
            error: "Failed to fetch monthly repository contributors",
          },
          500,
        );
      }
    },
  );
}
