import { Context, Hono, Next } from "hono";
import {
  CreateTeamRequestSchema,
  ReplaceTeamMembersRequestSchema,
  UpdateTeamRequestSchema,
} from "../../../shared/models/team.ts";
import {
  TeamNotFoundError,
  TeamReadOnlyError,
  UnknownUserIdsError,
} from "./teamsErrors.ts";
import { TeamsService } from "./teamsService.ts";

type Middleware = (c: Context, next: Next) => Promise<Response | void>;

type TeamsRouteDeps = {
  authAndAuthzMiddleware: Middleware;
  resolveRepositoryIdParam: (c: Context) => number | null;
  resolveTeamIdParam: (c: Context) => number | null;
  getTeamsService: () => TeamsService;
};

export function registerTeamsRoutes(app: Hono, deps: TeamsRouteDeps) {
  app.get(
    "/api/repository/:repositoryId/teams",
    deps.authAndAuthzMiddleware,
    async (c: Context) => {
      try {
        const repositoryId = deps.resolveRepositoryIdParam(c);
        if (repositoryId === null) {
          return c.json({ error: "Invalid repository ID" }, 400);
        }

        const teams = await deps.getTeamsService().listTeams(repositoryId);
        return c.json(teams);
      } catch (error) {
        console.error("Error fetching teams:", error);
        return c.json({ error: "Failed to fetch teams" }, 500);
      }
    },
  );

  app.get(
    "/api/repository/:repositoryId/teams/available-users",
    deps.authAndAuthzMiddleware,
    async (c: Context) => {
      try {
        const repositoryId = deps.resolveRepositoryIdParam(c);
        if (repositoryId === null) {
          return c.json({ error: "Invalid repository ID" }, 400);
        }

        const users = await deps
          .getTeamsService()
          .listAvailableUsers(repositoryId);
        return c.json(users);
      } catch (error) {
        console.error("Error fetching team users:", error);
        return c.json({ error: "Failed to fetch available users" }, 500);
      }
    },
  );

  app.get(
    "/api/repository/:repositoryId/teams/:teamId/members",
    deps.authAndAuthzMiddleware,
    async (c: Context) => {
      try {
        const repositoryId = deps.resolveRepositoryIdParam(c);
        const teamId = deps.resolveTeamIdParam(c);
        if (repositoryId === null) {
          return c.json({ error: "Invalid repository ID" }, 400);
        }
        if (teamId === null) {
          return c.json({ error: "Invalid team ID" }, 400);
        }

        const members = await deps
          .getTeamsService()
          .getTeamMembers(repositoryId, teamId);
        return c.json(members);
      } catch (error) {
        if (error instanceof TeamNotFoundError) {
          return c.json({ error: "Team not found" }, 404);
        }
        console.error("Error fetching team members:", error);
        return c.json({ error: "Failed to fetch team members" }, 500);
      }
    },
  );

  app.post(
    "/api/repository/:repositoryId/teams",
    deps.authAndAuthzMiddleware,
    async (c: Context) => {
      try {
        const repositoryId = deps.resolveRepositoryIdParam(c);
        if (repositoryId === null) {
          return c.json({ error: "Invalid repository ID" }, 400);
        }

        const body = await c.req.json();
        const parsed = CreateTeamRequestSchema.safeParse(body);
        if (!parsed.success) {
          return c.json({ error: "Invalid team payload" }, 400);
        }

        const team = await deps
          .getTeamsService()
          .createManualTeam(repositoryId, parsed.data);
        return c.json(team, 201);
      } catch (error) {
        if (error instanceof UnknownUserIdsError) {
          return c.json({ error: error.message }, 400);
        }
        console.error("Error creating team:", error);
        return c.json({ error: "Failed to create team" }, 500);
      }
    },
  );

  app.patch(
    "/api/repository/:repositoryId/teams/:teamId",
    deps.authAndAuthzMiddleware,
    async (c: Context) => {
      try {
        const repositoryId = deps.resolveRepositoryIdParam(c);
        const teamId = deps.resolveTeamIdParam(c);
        if (repositoryId === null) {
          return c.json({ error: "Invalid repository ID" }, 400);
        }
        if (teamId === null) {
          return c.json({ error: "Invalid team ID" }, 400);
        }

        const body = await c.req.json();
        const parsed = UpdateTeamRequestSchema.safeParse(body);
        if (!parsed.success) {
          return c.json({ error: "Invalid team payload" }, 400);
        }

        const team = await deps
          .getTeamsService()
          .updateManualTeam(repositoryId, teamId, parsed.data);
        return c.json(team);
      } catch (error) {
        if (error instanceof TeamNotFoundError) {
          return c.json({ error: "Team not found" }, 404);
        }
        if (error instanceof TeamReadOnlyError) {
          return c.json({ error: error.message }, 409);
        }
        console.error("Error updating team:", error);
        return c.json({ error: "Failed to update team" }, 500);
      }
    },
  );

  app.patch(
    "/api/repository/:repositoryId/teams/:teamId/members",
    deps.authAndAuthzMiddleware,
    async (c: Context) => {
      try {
        const repositoryId = deps.resolveRepositoryIdParam(c);
        const teamId = deps.resolveTeamIdParam(c);
        if (repositoryId === null) {
          return c.json({ error: "Invalid repository ID" }, 400);
        }
        if (teamId === null) {
          return c.json({ error: "Invalid team ID" }, 400);
        }

        const body = await c.req.json();
        const parsed = ReplaceTeamMembersRequestSchema.safeParse(body);
        if (!parsed.success) {
          return c.json({ error: "Invalid team member payload" }, 400);
        }

        const members = await deps
          .getTeamsService()
          .replaceManualTeamMembers(repositoryId, teamId, parsed.data.userIds);
        return c.json(members);
      } catch (error) {
        if (error instanceof TeamNotFoundError) {
          return c.json({ error: "Team not found" }, 404);
        }
        if (
          error instanceof UnknownUserIdsError ||
          error instanceof TeamReadOnlyError
        ) {
          return c.json({ error: error.message }, 400);
        }
        console.error("Error replacing team members:", error);
        return c.json({ error: "Failed to update team members" }, 500);
      }
    },
  );
}
