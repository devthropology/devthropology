import { Context, Hono, Next } from "hono";
import { z } from "zod";
import { AuthUser } from "../../models/auth.ts";
import { RepositoryDetails } from "../../models/dbTypes.ts";
import { IRepository } from "../../repository/repository.ts";
import { AuthorizationService } from "../../authorizationService.ts";
import { AgentContextService } from "./agentContextService.ts";

const RelatedFilesRequestSchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(50),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

export type AgentContextRouteDeps = {
  authAndAuthzMiddleware: Middleware;
  getRepository: () => IRepository;
  getAuthzService: () => AuthorizationService;
  getAgentContextService: () => AgentContextService;
};

type Middleware = (c: Context, next: Next) => Promise<Response | void>;

export function registerAgentContextRoutes(
  app: Hono,
  deps: AgentContextRouteDeps,
) {
  app.post(
    "/api/agent-context/:owner/:repo/related-files",
    deps.authAndAuthzMiddleware,
    async (c: Context) => {
      const owner = c.req.param("owner");
      const repo = c.req.param("repo");
      const user = c.get("user") as AuthUser | undefined;
      const repository = deps.getRepository();
      const authzService = deps.getAuthzService();
      const service = deps.getAgentContextService();

      if (!user) return c.json({ error: "Authentication required" }, 401);

      let requestJson: unknown;
      try {
        requestJson = await c.req.json();
      } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
      }

      const parsedBody = RelatedFilesRequestSchema.safeParse(requestJson);
      if (!parsedBody.success) {
        return c.json(
          {
            error: "Invalid request body",
            details: parsedBody.error.issues,
          },
          400,
        );
      }

      const repositoryMetadata = await findRepositoryByOwnerAndName(
        repository,
        owner,
        repo,
      );
      if (!repositoryMetadata) {
        return c.json({ error: "Repository not found" }, 404);
      }

      const canAccess = await authzService.canAccessRepositoryById(
        user,
        repositoryMetadata.repository_id,
      );
      if (!canAccess) return c.json({ error: "Access denied" }, 403);

      const response = await service.getRelatedFiles(
        repositoryMetadata.repository_id,
        { org: repositoryMetadata.org, name: repositoryMetadata.name },
        parsedBody.data.paths,
        parsedBody.data.limit,
      );

      return c.json(response);
    },
  );
}

async function findRepositoryByOwnerAndName(
  repository: IRepository,
  owner: string,
  name: string,
): Promise<RepositoryDetails | null> {
  const normalizedOwner = owner.toLowerCase();
  const normalizedName = name.toLowerCase();
  const repositories = await repository.getRepositoryDetails();

  return (
    repositories.find(
      (candidate) =>
        candidate.org.toLowerCase() === normalizedOwner &&
        candidate.name.toLowerCase() === normalizedName,
    ) ?? null
  );
}
