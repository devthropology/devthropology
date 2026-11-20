import { type Context, Hono, type Next } from "hono";
import type { AuthUser } from "../../models/auth.ts";
import { CombinedReportSelectionSchema } from "../../../shared/models/combinedReports.ts";
import type { IWorkspaceRepository } from "../../repository/workspaceRepository.ts";
import type { AuthorizationService } from "../../authorizationService.ts";
import { resolveRepositoryRef } from "../../repositoryPublicId.ts";
import type { ReportsService } from "./reportsService.ts";

type ReportsRouteDeps = {
  authMiddleware: (c: Context, next: Next) => Promise<Response | void>;
  getReportsService: () => ReportsService;
  getWorkspaceRepository: () => Pick<
    IWorkspaceRepository,
    "getWorkspaceRepositories"
  >;
  getAuthorizationService: () => Pick<
    AuthorizationService,
    "canAccessRepositoryById"
  >;
};

export function registerReportsRoutes(app: Hono, deps: ReportsRouteDeps) {
  for (const report of ["authors", "reviewers"] as const) {
    // Deliberately uncached for now: every request checks current access and
    // workspace scope, and no stale aggregate survives a scope change.
    app.get(
      `/api/reports/${report}`,
      deps.authMiddleware,
      async (c: Context) => {
        const user = c.get("user") as AuthUser | undefined;
        if (!user) return c.json({ error: "Authentication required." }, 401);
        if (user.role !== "superuser") {
          return c.json({ error: "Superuser role required." }, 403);
        }

        const params = new URL(c.req.url).searchParams;
        const parsed = CombinedReportSelectionSchema.safeParse({
          workspaceId: params.get("workspaceId"),
          repositoryIds: params.getAll("repositoryIds"),
          startDate: params.get("startDate"),
          endDate: params.get("endDate"),
          report,
        });
        if (!parsed.success) {
          return c.json(
            {
              error:
                "Select 1–20 repositories, a workspace, and a valid date range.",
            },
            400,
          );
        }
        const selection = parsed.data;
        const resolved = selection.repositoryIds.map(resolveRepositoryRef);
        if (
          resolved.some(
            (id) => id === null || !Number.isSafeInteger(id) || id < 0,
          )
        ) {
          return c.json({ error: "Invalid repository ID." }, 400);
        }
        const repositoryIds = [...new Set(resolved as number[])].sort(
          (a, b) => a - b,
        );
        try {
          const workspaces = deps.getWorkspaceRepository();
          const workspaceIds = new Set(
            await workspaces.getWorkspaceRepositories(selection.workspaceId),
          );
          if (!repositoryIds.every((id) => workspaceIds.has(id))) {
            return c.json(
              { error: "Report selection is not accessible." },
              403,
            );
          }
          const access = await Promise.all(
            repositoryIds.map((id) =>
              deps.getAuthorizationService().canAccessRepositoryById(user, id),
            ),
          );
          if (access.some((allowed) => !allowed)) {
            return c.json(
              { error: "Report selection is not accessible." },
              403,
            );
          }

          // Match existing report semantics: PR creation date in [start, end).
          const start = new Date(selection.startDate);
          const end = new Date(selection.endDate);
          const service = deps.getReportsService();
          const response =
            report === "authors"
              ? await service.getAuthors(repositoryIds, start, end)
              : await service.getReviewers(repositoryIds, start, end);
          c.header("Cache-Control", "private, no-store");
          return c.json(response);
        } catch (error) {
          console.error(`Failed to fetch combined ${report} report:`, error);
          return c.json(
            {
              error: "Could not load the combined report. Please try again.",
            },
            500,
          );
        }
      },
    );
  }
}
