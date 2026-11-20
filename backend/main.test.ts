import { env } from "node:process";
import {
  deepStrictEqual as assertEquals,
  ok as assert,
} from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "./main.ts";
import { getTestDatabase } from "./testUtils/testDatabase.ts";
import { AuthenticationService } from "./authenticationService.ts";
import { AuthorizationService } from "./authorizationService.ts";
import { PostgresAuthRepository } from "./repository/postgresAuthRepository.ts";
import { PostgresWorkspaceRepository } from "./repository/postgresWorkspaceRepository.ts";
import { PostgresTeamRepository } from "./repository/postgresTeamRepository.ts";
import { AuthenticationIdentityService } from "./services/authenticationIdentityService.ts";
import { createSqlClient } from "./repository/sqlClient.ts";
import { encodeRepositoryId } from "./repositoryPublicId.ts";
import { GithubLoginRepository } from "./features/githubLogin/githubLoginRepository.ts";
import { RepositoryRepository } from "./repository/repositoryRepository.ts";

const ApiRepositoryDetailsSchema = z.object({
  id: z.string(),
  org: z.string(),
  name: z.string(),
  last_sync_at: z.string().nullable().optional(),
});

async function getUserIdsByLogin(
  connectionString: string,
  logins: string[],
): Promise<number[]> {
  const sql = createSqlClient(connectionString);
  try {
    const rows = await sql.unsafe<
      { user_id: number | string; gh_login: string }[]
    >(
      `
        SELECT user_id, gh_login
        FROM "user"
        WHERE gh_login = ANY($1::text[])
        ORDER BY array_position($1::text[], gh_login)
      `,
      [logins],
    );
    return rows.map((row) => Number(row.user_id));
  } finally {
    await sql.end();
  }
}

function sanitizeTeamSnapshot(value: Record<string, unknown>) {
  return {
    ...value,
    teamId: "<teamId>",
    createdAt: "<createdAt>",
    updatedAt: "<updatedAt>",
  };
}

function sanitizeTeamMemberSnapshot(value: Record<string, unknown>) {
  return {
    ...value,
    teamMemberId: "<teamMemberId>",
    teamId: "<teamId>",
    createdAt: "<createdAt>",
    updatedAt: "<updatedAt>",
  };
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete env[key];
    return;
  }

  env[key] = value;
}

describe("Backend E2E Tests", () => {
  describe("API Endpoints - HTTP Layer Tests", () => {
    it("GET /robots.txt blocks crawlers without auth", async () => {
      const {
        repository,
        ghApi,
        connectionString,
        computedUserMetricsRepository,
      } = await getTestDatabase();
      const authRepo = new PostgresAuthRepository(
        createSqlClient(connectionString),
      );
      try {
        const identityService = new AuthenticationIdentityService(authRepo, {
          passwordPepper: "test-pepper",
        });
        const { app } = await createApp({
          repository,
          ghApi,
          authenticationIdentityService: identityService,
          computedUserMetricsRepository,
        });

        const response = await app.request("/robots.txt");

        assertEquals(response.status, 200);
        assertEquals(
          response.headers.get("content-type"),
          "text/plain; charset=UTF-8",
        );
        assertEquals(await response.text(), "User-agent: *\nDisallow: /\n");
      } finally {
        await authRepo.close();
      }
    });

    it("GET /api/repository - returns repositories with auth", async () => {
      const {
        repository,
        ghApi,
        connectionString,
        computedUserMetricsRepository,
      } = await getTestDatabase();
      const authRepo = new PostgresAuthRepository(
        createSqlClient(connectionString),
      );
      try {
        const identityService = new AuthenticationIdentityService(authRepo, {
          passwordPepper: "test-pepper",
        });
        const authService = new AuthenticationService(identityService);
        // Use no-arg constructor - superuser bypasses all checks
        const authzService = new AuthorizationService();
        const { app } = await createApp({
          repository,
          ghApi,
          authService,
          authzService,
          authenticationIdentityService: identityService,
          computedUserMetricsRepository,
        });

        // Use superuser role to bypass authz checks (test is for HTTP layer, not authz)
        const adminUsername = `superuser-${crypto.randomUUID()}@example.com`;
        await identityService.createUser(
          adminUsername,
          "hunter2!",
          "superuser",
        );
        const login = await identityService.authenticateWithPassword(
          adminUsername,
          "hunter2!",
        );
        if (!login) {
          throw new Error("Expected login to succeed");
        }
        const token = login.token;

        const response = await app.request("/api/repository", {
          headers: {
            Cookie: `auth-token=${token}`,
          },
        });

        assertEquals(response.status, 200);
        const data = await response.json();

        const parsed = z.array(ApiRepositoryDetailsSchema).parse(data);

        // Assert that the expected repository is present
        const tailscaleRepo = parsed.find(
          (repo) => repo.org === "tailscale" && repo.name === "tailscale",
        );
        assertEquals(tailscaleRepo?.id, encodeRepositoryId(1));
        assertEquals(tailscaleRepo?.org, "tailscale");
        assertEquals(tailscaleRepo?.name, "tailscale");
      } finally {
        await authRepo.close();
      }
    });

    it("repository-scoped endpoints accept both numeric and encoded repository refs", async () => {
      const {
        repository,
        ghApi,
        connectionString,
        computedUserMetricsRepository,
      } = await getTestDatabase();
      const authRepo = new PostgresAuthRepository(
        createSqlClient(connectionString),
      );
      try {
        const identityService = new AuthenticationIdentityService(authRepo, {
          passwordPepper: "test-pepper",
        });
        const authService = new AuthenticationService(identityService);
        const authzService = new AuthorizationService();
        const { app } = await createApp({
          repository,
          ghApi,
          authService,
          authzService,
          authenticationIdentityService: identityService,
          computedUserMetricsRepository,
        });

        const adminUsername = `superuser-${crypto.randomUUID()}@example.com`;
        await identityService.createUser(
          adminUsername,
          "hunter2!",
          "superuser",
        );
        const login = await identityService.authenticateWithPassword(
          adminUsername,
          "hunter2!",
        );
        if (!login) {
          throw new Error("Expected login to succeed");
        }

        const headers = {
          Cookie: `auth-token=${login.token}`,
        };
        const encodedRepositoryId = encodeRepositoryId(1);

        const [numericResponse, encodedResponse] = await Promise.all([
          app.request("/api/filesystem/1/tree?levels=1", { headers }),
          app.request(`/api/filesystem/${encodedRepositoryId}/tree?levels=1`, {
            headers,
          }),
        ]);

        assertEquals(numericResponse.status, 200);
        assertEquals(encodedResponse.status, 200);

        const numericData = await numericResponse.json();
        const encodedData = await encodedResponse.json();

        assertEquals(encodedData, numericData);
      } finally {
        await authRepo.close();
      }
    });

    it("GET /api/repository - returns 401 without auth", async () => {
      const {
        repository,
        ghApi,
        connectionString,
        computedUserMetricsRepository,
      } = await getTestDatabase();
      const authRepo = new PostgresAuthRepository(
        createSqlClient(connectionString),
      );
      try {
        const identityService = new AuthenticationIdentityService(authRepo, {
          passwordPepper: "test-pepper",
        });
        const authService = new AuthenticationService(identityService);
        // Use no-arg constructor - superuser bypasses all checks
        const authzService = new AuthorizationService();
        const { app } = await createApp({
          repository,
          ghApi,
          authService,
          authzService,
          authenticationIdentityService: identityService,
          computedUserMetricsRepository,
        });

        const response = await app.request("/api/repository");

        assertEquals(response.status, 401);
        const data = await response.json();
        assertEquals(data.error, "Authentication required");
      } finally {
        await authRepo.close();
      }
    });

    it("GET /api/repository - returns 401 with invalid token", async () => {
      const {
        repository,
        ghApi,
        connectionString,
        computedUserMetricsRepository,
      } = await getTestDatabase();
      const authRepo = new PostgresAuthRepository(
        createSqlClient(connectionString),
      );
      try {
        const identityService = new AuthenticationIdentityService(authRepo, {
          passwordPepper: "test-pepper",
        });
        const authService = new AuthenticationService(identityService);
        // Use no-arg constructor - superuser bypasses all checks
        const authzService = new AuthorizationService();
        const { app } = await createApp({
          repository,
          ghApi,
          authService,
          authzService,
          authenticationIdentityService: identityService,
          computedUserMetricsRepository,
        });

        await identityService.createUser(
          `user-${crypto.randomUUID()}@example.com`,
          "hunter2!",
          "user",
        );

        const response = await app.request("/api/repository", {
          headers: {
            Cookie: "auth-token=invalid-token",
          },
        });

        assertEquals(response.status, 401);
        const data = await response.json();
        assertEquals(data.error, "Invalid or expired token");
      } finally {
        await authRepo.close();
      }
    });

    it("POST /api/auth/demo-login returns 404 when disabled", async () => {
      const {
        repository,
        ghApi,
        connectionString,
        computedUserMetricsRepository,
      } = await getTestDatabase();
      const authRepo = new PostgresAuthRepository(
        createSqlClient(connectionString),
      );
      const previousEnabled = env.ENABLE_DEMO_LOGIN;
      try {
        env.ENABLE_DEMO_LOGIN = "false";
        const identityService = new AuthenticationIdentityService(authRepo, {
          passwordPepper: "test-pepper",
        });
        const authService = new AuthenticationService(identityService);
        const authzService = new AuthorizationService();
        const { app } = await createApp({
          repository,
          ghApi,
          authService,
          authzService,
          authenticationIdentityService: identityService,
          computedUserMetricsRepository,
        });

        const response = await app.request("/api/auth/demo-login", {
          method: "POST",
        });

        assertEquals(response.status, 404);
        assertEquals(await response.json(), { error: "Not found" });
      } finally {
        restoreEnv("ENABLE_DEMO_LOGIN", previousEnabled);
        await authRepo.close();
      }
    });

    it("POST /api/auth/demo-login returns 404 when enabled but not configured", async () => {
      const {
        repository,
        ghApi,
        connectionString,
        computedUserMetricsRepository,
      } = await getTestDatabase();
      const authRepo = new PostgresAuthRepository(
        createSqlClient(connectionString),
      );
      const previousEnabled = env.ENABLE_DEMO_LOGIN;
      const previousUsername = env.DEMO_USERNAME;
      const previousPassword = env.DEMO_PASSWORD;
      try {
        env.ENABLE_DEMO_LOGIN = "true";
        delete env.DEMO_USERNAME;
        delete env.DEMO_PASSWORD;
        const identityService = new AuthenticationIdentityService(authRepo, {
          passwordPepper: "test-pepper",
        });
        const authService = new AuthenticationService(identityService);
        const authzService = new AuthorizationService();
        const { app } = await createApp({
          repository,
          ghApi,
          authService,
          authzService,
          authenticationIdentityService: identityService,
          computedUserMetricsRepository,
        });

        const response = await app.request("/api/auth/demo-login", {
          method: "POST",
        });

        assertEquals(response.status, 404);
        assertEquals(await response.json(), { error: "Not found" });
      } finally {
        restoreEnv("ENABLE_DEMO_LOGIN", previousEnabled);
        restoreEnv("DEMO_USERNAME", previousUsername);
        restoreEnv("DEMO_PASSWORD", previousPassword);
        await authRepo.close();
      }
    });

    it("POST /api/auth/demo-login returns a real login response when enabled", async () => {
      const {
        repository,
        ghApi,
        connectionString,
        computedUserMetricsRepository,
      } = await getTestDatabase();
      const authRepo = new PostgresAuthRepository(
        createSqlClient(connectionString),
      );
      const previousEnabled = env.ENABLE_DEMO_LOGIN;
      const previousUsername = env.DEMO_USERNAME;
      const previousPassword = env.DEMO_PASSWORD;
      try {
        const demoUsername = `demo-${crypto.randomUUID()}@example.com`;
        const demoPassword = "hunter2!";
        env.ENABLE_DEMO_LOGIN = "true";
        env.DEMO_USERNAME = demoUsername;
        env.DEMO_PASSWORD = demoPassword;

        const identityService = new AuthenticationIdentityService(authRepo, {
          passwordPepper: "test-pepper",
        });
        const authService = new AuthenticationService(identityService);
        const authzService = new AuthorizationService();
        const { app } = await createApp({
          repository,
          ghApi,
          authService,
          authzService,
          authenticationIdentityService: identityService,
          computedUserMetricsRepository,
        });
        await identityService.createUser(demoUsername, demoPassword, "user");

        const response = await app.request("/api/auth/demo-login", {
          method: "POST",
        });

        assertEquals(response.status, 200);
        assert(response.headers.get("Set-Cookie")?.startsWith("auth-token="));
        const data = await response.json();
        assertEquals(data.username, demoUsername);
        assertEquals(data.role, "user");
        assert(typeof data.token === "string" && data.token.length > 0);
      } finally {
        restoreEnv("ENABLE_DEMO_LOGIN", previousEnabled);
        restoreEnv("DEMO_USERNAME", previousUsername);
        restoreEnv("DEMO_PASSWORD", previousPassword);
        await authRepo.close();
      }
    });

    it("POST /api/auth/users - honors the requested role", async () => {
      const {
        repository,
        ghApi,
        connectionString,
        computedUserMetricsRepository,
      } = await getTestDatabase();
      const authRepo = new PostgresAuthRepository(
        createSqlClient(connectionString),
      );
      try {
        const identityService = new AuthenticationIdentityService(authRepo, {
          passwordPepper: "test-pepper",
        });
        const authService = new AuthenticationService(identityService);
        // Use no-arg constructor - superuser bypasses all checks
        const authzService = new AuthorizationService();
        const { app } = await createApp({
          repository,
          ghApi,
          authService,
          authzService,
          authenticationIdentityService: identityService,
          computedUserMetricsRepository,
        });

        const adminUsername = `superuser-${crypto.randomUUID()}@example.com`;
        const adminPassword = "hunter2!";
        await identityService.createUser(
          adminUsername,
          adminPassword,
          "superuser",
        );
        const adminLogin = await identityService.authenticateWithPassword(
          adminUsername,
          adminPassword,
        );

        if (!adminLogin) {
          throw new Error("Expected admin login to succeed");
        }

        const newUserUsername = `demo-${crypto.randomUUID()}@example.com`;
        const response = await app.request("/api/auth/users", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${adminLogin.token}`,
          },
          body: JSON.stringify({
            username: newUserUsername,
            password: "Sup3rSecretPass!",
            role: "demo",
          }),
        });

        assertEquals(response.status, 201);
        const createdUser = await response.json();
        assertEquals(createdUser.username, newUserUsername);
        assertEquals(createdUser.role, "demo");

        // Legacy admin accounts must not inherit superuser-only user creation.
        const legacyUsername = `admin-${crypto.randomUUID()}@example.com`;
        await identityService.createUser(
          legacyUsername,
          adminPassword,
          "admin",
        );
        const legacyLogin = await identityService.authenticateWithPassword(
          legacyUsername,
          adminPassword,
        );
        assert(legacyLogin);
        const denied = await app.request("/api/auth/users", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${legacyLogin.token}`,
          },
          body: JSON.stringify({
            username: `blocked-${crypto.randomUUID()}`,
            password: "Sup3rSecretPass!",
            role: "user",
          }),
        });
        assertEquals(denied.status, 403);
        assertEquals((await denied.json()).error, "Superuser role required");
      } finally {
        await authRepo.close();
      }
    });
  });

  describe("Workspace API Endpoints", () => {
    it("GitHub signup authenticates API requests immediately without granting unrelated repository access", async () => {
      const {
        repository,
        ghApi,
        connectionString,
        computedUserMetricsRepository,
      } = await getTestDatabase();
      const sql = createSqlClient(connectionString);
      const workspaceRepo = new PostgresWorkspaceRepository(sql);
      const identityService = new AuthenticationIdentityService(
        new PostgresAuthRepository(sql),
        { passwordPepper: "test" },
      );
      const githubId = crypto.randomUUID();
      let userId: string | undefined;
      try {
        const { app } = await createApp({
          repository,
          ghApi,
          computedUserMetricsRepository,
          authenticationIdentityService: identityService,
          workspaceRepository: workspaceRepo,
          repositoryRepository: new RepositoryRepository(sql),
          authzService: new AuthorizationService(workspaceRepo),
        });
        // Provision after the API instance has loaded its authentication cache.
        const account = await new GithubLoginRepository(sql).provision(
          githubId,
          `api-${githubId}`,
        );
        assert(account);
        userId = account.userId;
        const headers = { Authorization: `Bearer ${account.token}` };
        const workspaceResponse = await app.request("/api/workspaces", {
          headers,
        });
        assertEquals(workspaceResponse.status, 200);
        const workspaces = await workspaceResponse.json();
        assertEquals(workspaces.length, 1);
        assertEquals(workspaces[0].createdBy, userId);
        const repositories = await app.request("/api/repository", { headers });
        assertEquals(repositories.status, 200);
        assertEquals(await repositories.json(), []);
        const unrelated = (await repository.getRepositoryDetails())[0];
        assert(unrelated);
        const denied = await app.request(
          `/api/repository/${encodeRepositoryId(
            unrelated.repository_id,
          )}/overview`,
          { headers },
        );
        assertEquals(denied.status, 403);
      } finally {
        if (userId) {
          await sql`DELETE FROM workspace WHERE created_by = ${userId}`;
          await sql`DELETE FROM github_identity WHERE github_user_id = ${githubId}`;
          await sql`DELETE FROM auth_users WHERE auth_user_id = ${userId}`;
        }
        await sql.end();
      }
    });

    it("GET /api/workspaces - superuser sees all workspaces", async () => {
      const {
        repository,
        ghApi,
        connectionString,
        computedUserMetricsRepository,
      } = await getTestDatabase();
      const sql = createSqlClient(connectionString);
      const authRepo = new PostgresAuthRepository(sql);
      const workspaceRepo = new PostgresWorkspaceRepository(sql);

      try {
        const identityService = new AuthenticationIdentityService(authRepo, {
          passwordPepper: "test-pepper",
        });
        const authService = new AuthenticationService(identityService);
        const authzService = new AuthorizationService(workspaceRepo);
        const { app } = await createApp({
          repository,
          ghApi,
          authService,
          authzService,
          authenticationIdentityService: identityService,
          computedUserMetricsRepository,
          workspaceRepository: workspaceRepo,
        });

        // Create a superuser
        const superUsername = `super-${crypto.randomUUID()}@example.com`;
        await identityService.createUser(
          superUsername,
          "hunter2!",
          "superuser",
        );
        const login = await identityService.authenticateWithPassword(
          superUsername,
          "hunter2!",
        );
        if (!login) throw new Error("Expected login to succeed");

        // Create a test workspace
        await workspaceRepo.createWorkspace(
          "Test Workspace",
          `test-ws-${crypto.randomUUID().slice(0, 8)}`,
          "user",
          null,
        );

        const response = await app.request("/api/workspaces", {
          headers: {
            Authorization: `Bearer ${login.token}`,
          },
        });

        assertEquals(response.status, 200);
        const workspaces = await response.json();
        assert(Array.isArray(workspaces), "Should return array");
        assert(
          workspaces.length >= 1,
          "Superuser should see at least one workspace",
        );
      } finally {
        await authRepo.close();
      }
    });

    it("GET /api/workspaces - user sees only their workspaces", async () => {
      const {
        repository,
        ghApi,
        connectionString,
        computedUserMetricsRepository,
      } = await getTestDatabase();
      const sql = createSqlClient(connectionString);
      const authRepo = new PostgresAuthRepository(sql);
      const workspaceRepo = new PostgresWorkspaceRepository(sql);

      try {
        const identityService = new AuthenticationIdentityService(authRepo, {
          passwordPepper: "test-pepper",
        });
        const authService = new AuthenticationService(identityService);
        const authzService = new AuthorizationService(workspaceRepo);
        const { app } = await createApp({
          repository,
          ghApi,
          authService,
          authzService,
          authenticationIdentityService: identityService,
          computedUserMetricsRepository,
          workspaceRepository: workspaceRepo,
        });

        // Create a regular user
        const userUsername = `user-${crypto.randomUUID()}@example.com`;
        const createdUser = await identityService.createUser(
          userUsername,
          "hunter2!",
          "user",
        );
        const login = await identityService.authenticateWithPassword(
          userUsername,
          "hunter2!",
        );
        if (!login) throw new Error("Expected login to succeed");

        // User has no workspaces initially
        const response1 = await app.request("/api/workspaces", {
          headers: { Authorization: `Bearer ${login.token}` },
        });
        assertEquals(response1.status, 200);
        const workspaces1 = await response1.json();
        assertEquals(
          workspaces1.length,
          0,
          "User should see no workspaces initially",
        );

        // Create a workspace and add the user
        const workspace = await workspaceRepo.createWorkspace(
          "User Workspace",
          `user-ws-${crypto.randomUUID().slice(0, 8)}`,
          "user",
          null,
        );
        await workspaceRepo.addUserToWorkspace(
          workspace.workspaceId,
          createdUser.userId,
          "owner",
        );

        // Now user should see one workspace
        const response2 = await app.request("/api/workspaces", {
          headers: { Authorization: `Bearer ${login.token}` },
        });
        assertEquals(response2.status, 200);
        const workspaces2 = await response2.json();
        assertEquals(workspaces2.length, 1, "User should see one workspace");
        assertEquals(workspaces2[0].name, "User Workspace");
        assertEquals(workspaces2[0].repositoryIds, undefined);

        const groupedResponse = await app.request(
          "/api/workspaces?includeRepositories=1",
          { headers: { Authorization: `Bearer ${login.token}` } },
        );
        assertEquals(groupedResponse.status, 200);
        const grouped = await groupedResponse.json();
        assertEquals(grouped.length, 1);
        assertEquals(grouped[0].workspaceId, workspace.workspaceId);
        assertEquals(grouped[0].repositoryIds, []);
      } finally {
        await authRepo.close();
      }
    });

    it("GET /api/workspaces - demo user sees empty array", async () => {
      const {
        repository,
        ghApi,
        connectionString,
        computedUserMetricsRepository,
      } = await getTestDatabase();
      const sql = createSqlClient(connectionString);
      const authRepo = new PostgresAuthRepository(sql);
      const workspaceRepo = new PostgresWorkspaceRepository(sql);

      try {
        const identityService = new AuthenticationIdentityService(authRepo, {
          passwordPepper: "test-pepper",
        });
        const authService = new AuthenticationService(identityService);
        const authzService = new AuthorizationService(workspaceRepo);
        const { app } = await createApp({
          repository,
          ghApi,
          authService,
          authzService,
          authenticationIdentityService: identityService,
          computedUserMetricsRepository,
          workspaceRepository: workspaceRepo,
        });

        // Create a demo user
        const demoUsername = `demo-${crypto.randomUUID()}@example.com`;
        await identityService.createUser(demoUsername, "hunter2!", "demo");
        const login = await identityService.authenticateWithPassword(
          demoUsername,
          "hunter2!",
        );
        if (!login) throw new Error("Expected login to succeed");

        const response = await app.request("/api/workspaces", {
          headers: { Authorization: `Bearer ${login.token}` },
        });

        assertEquals(response.status, 200);
        const workspaces = await response.json();
        assertEquals(workspaces.length, 0, "Demo user should see empty array");
      } finally {
        await authRepo.close();
      }
    });

    it("POST /api/workspaces - user can create only user workspaces as owner", async () => {
      const {
        repository,
        ghApi,
        connectionString,
        computedUserMetricsRepository,
      } = await getTestDatabase();
      const sql = createSqlClient(connectionString);
      const authRepo = new PostgresAuthRepository(sql);
      const workspaceRepo = new PostgresWorkspaceRepository(sql);

      try {
        const identityService = new AuthenticationIdentityService(authRepo, {
          passwordPepper: "test-pepper",
        });
        const authService = new AuthenticationService(identityService);
        const authzService = new AuthorizationService(workspaceRepo);
        const { app } = await createApp({
          repository,
          ghApi,
          authService,
          authzService,
          authenticationIdentityService: identityService,
          computedUserMetricsRepository,
          workspaceRepository: workspaceRepo,
        });

        // Create a regular user
        const userUsername = `user-${crypto.randomUUID()}@example.com`;
        const createdUser = await identityService.createUser(
          userUsername,
          "hunter2!",
          "user",
        );
        const login = await identityService.authenticateWithPassword(
          userUsername,
          "hunter2!",
        );
        if (!login) throw new Error("Expected login to succeed");

        const response = await app.request("/api/workspaces", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${login.token}`,
          },
          body: JSON.stringify({
            name: "My New Workspace",
            workspaceType: "system",
          }),
        });

        assertEquals(response.status, 201);
        const workspace = await response.json();
        assertEquals(workspace.name, "My New Workspace");
        assertEquals(workspace.workspaceType, "user");

        const isInWorkspace = await workspaceRepo.isUserInWorkspace(
          createdUser.userId,
          workspace.workspaceId,
        );
        assertEquals(
          isInWorkspace,
          true,
          "Creator should be added to their workspace",
        );
        const membership = await sql<{ role: string }[]>`
          SELECT workspace_role AS role FROM workspace_member
          WHERE workspace_id = ${workspace.workspaceId}
            AND auth_user_id = ${createdUser.userId}
        `;
        assertEquals(membership[0]?.role, "owner");
      } finally {
        await authRepo.close();
      }
    });

    it("POST /api/workspaces - demo user cannot create workspace", async () => {
      const {
        repository,
        ghApi,
        connectionString,
        computedUserMetricsRepository,
      } = await getTestDatabase();
      const sql = createSqlClient(connectionString);
      const authRepo = new PostgresAuthRepository(sql);
      const workspaceRepo = new PostgresWorkspaceRepository(sql);

      try {
        const identityService = new AuthenticationIdentityService(authRepo, {
          passwordPepper: "test-pepper",
        });
        const authService = new AuthenticationService(identityService);
        const authzService = new AuthorizationService(workspaceRepo);
        const { app } = await createApp({
          repository,
          ghApi,
          authService,
          authzService,
          authenticationIdentityService: identityService,
          computedUserMetricsRepository,
          workspaceRepository: workspaceRepo,
        });

        // Create a demo user
        const demoUsername = `demo-${crypto.randomUUID()}@example.com`;
        await identityService.createUser(demoUsername, "hunter2!", "demo");
        const login = await identityService.authenticateWithPassword(
          demoUsername,
          "hunter2!",
        );
        if (!login) throw new Error("Expected login to succeed");

        const response = await app.request("/api/workspaces", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${login.token}`,
          },
          body: JSON.stringify({ name: "Should Fail" }),
        });

        assertEquals(response.status, 403);
        const data = await response.json();
        assertEquals(data.error, "Demo users cannot create workspaces");
      } finally {
        await authRepo.close();
      }
    });

    it("POST /api/repository - requires workspaceId", async () => {
      const {
        repository,
        ghApi,
        connectionString,
        computedUserMetricsRepository,
      } = await getTestDatabase();
      const sql = createSqlClient(connectionString);
      const authRepo = new PostgresAuthRepository(sql);
      const workspaceRepo = new PostgresWorkspaceRepository(sql);

      try {
        const identityService = new AuthenticationIdentityService(authRepo, {
          passwordPepper: "test-pepper",
        });
        const authService = new AuthenticationService(identityService);
        const authzService = new AuthorizationService(workspaceRepo);
        const { app } = await createApp({
          repository,
          ghApi,
          authService,
          authzService,
          authenticationIdentityService: identityService,
          computedUserMetricsRepository,
          workspaceRepository: workspaceRepo,
        });

        // Create a superuser
        const superUsername = `super-${crypto.randomUUID()}@example.com`;
        await identityService.createUser(
          superUsername,
          "hunter2!",
          "superuser",
        );
        const login = await identityService.authenticateWithPassword(
          superUsername,
          "hunter2!",
        );
        if (!login) throw new Error("Expected login to succeed");

        // Try to create repo without workspaceId
        const response = await app.request("/api/repository", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${login.token}`,
          },
          body: JSON.stringify({ org: "test", name: "repo" }),
        });

        assertEquals(response.status, 400);
        const data = await response.json();
        assertEquals(data.error, "workspaceId is required");
      } finally {
        await authRepo.close();
      }
    });

    it("manual management endpoints reject ordinary users", async () => {
      const {
        repository,
        ghApi,
        connectionString,
        computedUserMetricsRepository,
      } = await getTestDatabase();
      const sql = createSqlClient(connectionString);
      const authRepo = new PostgresAuthRepository(sql);
      const workspaceRepo = new PostgresWorkspaceRepository(sql);

      try {
        const identityService = new AuthenticationIdentityService(authRepo, {
          passwordPepper: "test-pepper",
        });
        const authService = new AuthenticationService(identityService);
        const authzService = new AuthorizationService(workspaceRepo);
        const { app } = await createApp({
          repository,
          ghApi,
          authService,
          authzService,
          authenticationIdentityService: identityService,
          computedUserMetricsRepository,
          workspaceRepository: workspaceRepo,
        });

        // Create a user
        const userUsername = `user-${crypto.randomUUID()}@example.com`;
        await identityService.createUser(userUsername, "hunter2!", "user");
        const login = await identityService.authenticateWithPassword(
          userUsername,
          "hunter2!",
        );
        if (!login) throw new Error("Expected login to succeed");

        // Create a workspace that the user is NOT a member of
        const otherWorkspace = await workspaceRepo.createWorkspace(
          "Other Workspace",
          `other-ws-${crypto.randomUUID().slice(0, 8)}`,
          "user",
          null,
        );

        // Try to create repo in workspace user doesn't have access to
        const response = await app.request("/api/repository", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${login.token}`,
          },
          body: JSON.stringify({
            org: "test",
            name: "repo",
            workspaceId: otherWorkspace.workspaceId,
          }),
        });

        assertEquals(response.status, 403);
        const data = await response.json();
        assertEquals(data.error, "Superuser role required");
        const denied = await app.request("/api/auth/users", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${login.token}`,
          },
          body: JSON.stringify({
            username: "blocked",
            password: "hunter2!",
            role: "user",
          }),
        });
        assertEquals(denied.status, 403);
        assertEquals((await denied.json()).error, "Superuser role required");
      } finally {
        await authRepo.close();
      }
    });

    it("POST/PATCH team endpoints manage manual teams", async () => {
      const {
        repository,
        ghApi,
        connectionString,
        computedUserMetricsRepository,
      } = await getTestDatabase();
      const authRepo = new PostgresAuthRepository(
        createSqlClient(connectionString),
      );
      const teamRepo = new PostgresTeamRepository(
        createSqlClient(connectionString),
      );

      try {
        const identityService = new AuthenticationIdentityService(authRepo, {
          passwordPepper: "test-pepper",
        });
        const authService = new AuthenticationService(identityService);
        const authzService = new AuthorizationService();
        const { app } = await createApp({
          repository,
          ghApi,
          authService,
          authzService,
          authenticationIdentityService: identityService,
          computedUserMetricsRepository,
          teamRepository: teamRepo,
        });

        const adminUsername = `superuser-${crypto.randomUUID()}@example.com`;
        await identityService.createUser(
          adminUsername,
          "hunter2!",
          "superuser",
        );
        const login = await identityService.authenticateWithPassword(
          adminUsername,
          "hunter2!",
        );
        if (!login) {
          throw new Error("Expected login to succeed");
        }

        const repositoryRef = encodeRepositoryId(1);
        const initialUserIds = await getUserIdsByLogin(connectionString, [
          "danderson",
          "crawshaw",
          "bradfitz",
        ]);

        const createResponse = await app.request(
          `/api/repository/${repositoryRef}/teams`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Cookie: `auth-token=${login.token}`,
            },
            body: JSON.stringify({
              name: `API Team ${crypto.randomUUID().slice(0, 8)}`,
              userIds: initialUserIds,
            }),
          },
        );

        assertEquals(createResponse.status, 201);
        const created = await createResponse.json();
        assertEquals(created.sourceType, "manual");
        assertEquals(created.memberCount, 3);

        const renameResponse = await app.request(
          `/api/repository/${repositoryRef}/teams/${created.teamId}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Cookie: `auth-token=${login.token}`,
            },
            body: JSON.stringify({ name: "Platform Team" }),
          },
        );

        assertEquals(renameResponse.status, 200);
        const renamed = await renameResponse.json();
        assertEquals(renamed.name, "Platform Team");
        assertEquals(renamed.slug.startsWith("platform-team"), true);

        const replacementUserIds = await getUserIdsByLogin(connectionString, [
          "danderson",
          "bradfitz",
        ]);
        const replaceMembersResponse = await app.request(
          `/api/repository/${repositoryRef}/teams/${created.teamId}/members`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Cookie: `auth-token=${login.token}`,
            },
            body: JSON.stringify({ userIds: replacementUserIds }),
          },
        );

        assertEquals(replaceMembersResponse.status, 200);
        const replacedMembers = await replaceMembersResponse.json();
        assertEquals(
          replacedMembers.map((member: { ghLogin: string }) => member.ghLogin),
          ["bradfitz", "danderson"],
        );
      } finally {
        await teamRepo.close();
        await authRepo.close();
      }
    });

    it("GET /api/repository/:repositoryId/teams returns snapshot", async () => {
      const {
        repository,
        ghApi,
        connectionString,
        computedUserMetricsRepository,
      } = await getTestDatabase();
      const authRepo = new PostgresAuthRepository(
        createSqlClient(connectionString),
      );
      const teamRepo = new PostgresTeamRepository(
        createSqlClient(connectionString),
      );
      const sql = createSqlClient(connectionString);

      try {
        await sql.unsafe(
          `DELETE FROM teams WHERE repository_id = $1 AND name = $2`,
          [1, "Snapshot Team"],
        );

        const userIds = await getUserIdsByLogin(connectionString, [
          "danderson",
          "crawshaw",
          "bradfitz",
        ]);
        await teamRepo.createManualTeam(1, "Snapshot Team", userIds);

        const identityService = new AuthenticationIdentityService(authRepo, {
          passwordPepper: "test-pepper",
        });
        const authService = new AuthenticationService(identityService);
        const authzService = new AuthorizationService();
        const { app } = await createApp({
          repository,
          ghApi,
          authService,
          authzService,
          authenticationIdentityService: identityService,
          computedUserMetricsRepository,
          teamRepository: teamRepo,
        });

        const adminUsername = `superuser-${crypto.randomUUID()}@example.com`;
        await identityService.createUser(
          adminUsername,
          "hunter2!",
          "superuser",
        );
        const login = await identityService.authenticateWithPassword(
          adminUsername,
          "hunter2!",
        );
        if (!login) {
          throw new Error("Expected login to succeed");
        }

        const response = await app.request(
          `/api/repository/${encodeRepositoryId(1)}/teams`,
          {
            headers: {
              Cookie: `auth-token=${login.token}`,
            },
          },
        );

        assertEquals(response.status, 200);
        const teams = await response.json();
        const snapshotPayload = teams
          .filter((team: { name: string }) => team.name === "Snapshot Team")
          .map((team: Record<string, unknown>) => sanitizeTeamSnapshot(team));
        expect(snapshotPayload).toMatchSnapshot();
      } finally {
        await sql.end();
        await teamRepo.close();
        await authRepo.close();
      }
    });

    it("GET /api/repository/:repositoryId/teams/:teamId/members returns snapshot", async () => {
      const {
        repository,
        ghApi,
        connectionString,
        computedUserMetricsRepository,
      } = await getTestDatabase();
      const authRepo = new PostgresAuthRepository(
        createSqlClient(connectionString),
      );
      const teamRepo = new PostgresTeamRepository(
        createSqlClient(connectionString),
      );
      const sql = createSqlClient(connectionString);

      try {
        await sql.unsafe(
          `DELETE FROM teams WHERE repository_id = $1 AND name = $2`,
          [1, "Snapshot Members Team"],
        );

        const userIds = await getUserIdsByLogin(connectionString, [
          "danderson",
          "crawshaw",
          "bradfitz",
        ]);
        const team = await teamRepo.createManualTeam(
          1,
          "Snapshot Members Team",
          userIds,
        );

        const identityService = new AuthenticationIdentityService(authRepo, {
          passwordPepper: "test-pepper",
        });
        const authService = new AuthenticationService(identityService);
        const authzService = new AuthorizationService();
        const { app } = await createApp({
          repository,
          ghApi,
          authService,
          authzService,
          authenticationIdentityService: identityService,
          computedUserMetricsRepository,
          teamRepository: teamRepo,
        });

        const adminUsername = `superuser-${crypto.randomUUID()}@example.com`;
        await identityService.createUser(
          adminUsername,
          "hunter2!",
          "superuser",
        );
        const login = await identityService.authenticateWithPassword(
          adminUsername,
          "hunter2!",
        );
        if (!login) {
          throw new Error("Expected login to succeed");
        }

        const response = await app.request(
          `/api/repository/${encodeRepositoryId(
            1,
          )}/teams/${team.teamId}/members`,
          {
            headers: {
              Cookie: `auth-token=${login.token}`,
            },
          },
        );

        assertEquals(response.status, 200);
        const members = await response.json();
        expect(
          members.map((member: Record<string, unknown>) =>
            sanitizeTeamMemberSnapshot(member),
          ),
        ).toMatchSnapshot();
      } finally {
        await sql.end();
        await teamRepo.close();
        await authRepo.close();
      }
    });
  });
});
