import {
  deepStrictEqual as assertEquals,
  ok as assert,
} from "node:assert/strict";
import { describe, it } from "vitest";
import { getTestDatabase } from "../testUtils/testDatabase.ts";
import { PostgresWorkspaceRepository } from "../repository/postgresWorkspaceRepository.ts";
import { PostgresAuthRepository } from "../repository/postgresAuthRepository.ts";
import { AuthenticationIdentityService } from "./authenticationIdentityService.ts";
import { AuthorizationService } from "../authorizationService.ts";
import { createSqlClient } from "../repository/sqlClient.ts";
import { AuthUser } from "../models/auth.ts";
import { IWorkspaceRepository } from "../repository/workspaceRepository.ts";

const TEST_PEPPER = "test-pepper";

describe("AuthorizationService", () => {
  it("superuser bypasses all access checks", async () => {
    const { connectionString } = await getTestDatabase();
    const sql = createSqlClient(connectionString);
    const workspaceRepo = new PostgresWorkspaceRepository(sql);
    const authzService = new AuthorizationService(workspaceRepo);

    const superuser: AuthUser = {
      userId: "superuser-123",
      username: "superadmin",
      role: "superuser",
    };

    // Superuser can access any repository ID (even non-existent ones)
    const canAccess = await authzService.canAccessRepositoryById(
      superuser,
      999999,
    );
    assertEquals(canAccess, true, "superuser should bypass all access checks");

    // Superuser gets null for accessible repos (meaning "all")
    const accessibleIds =
      await authzService.getAccessibleRepositoryIds(superuser);
    assertEquals(
      accessibleIds,
      null,
      "superuser should get null (meaning all repos)",
    );
  });

  it("rethrows transient workspace database errors", async () => {
    const transientError = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
    const workspaceRepo = {
      canUserAccessRepository: () => Promise.reject(transientError),
    } as unknown as IWorkspaceRepository;
    const authzService = new AuthorizationService(workspaceRepo);
    const user: AuthUser = {
      userId: "user-123",
      username: "user@example.com",
      role: "user",
    };

    let caughtError: unknown;
    try {
      await authzService.canAccessRepositoryById(user, 16);
    } catch (error) {
      caughtError = error;
    }

    assert(caughtError === transientError);
  });

  it("demo user can only access repos in their workspace", async () => {
    const { connectionString } = await getTestDatabase();
    const sql = createSqlClient(connectionString);
    const workspaceRepo = new PostgresWorkspaceRepository(sql);
    const authzService = new AuthorizationService(workspaceRepo);

    // Create a real demo user in the database
    const authRepo = new PostgresAuthRepository(sql);
    const identityService = new AuthenticationIdentityService(authRepo, {
      passwordPepper: TEST_PEPPER,
    });
    await identityService.initialize();

    const demoUsername = `demo-${crypto.randomUUID().slice(0, 8)}`;
    const createdUser = await identityService.createUser(
      demoUsername,
      "TestPass123!",
      "demo",
    );

    const demoUser: AuthUser = {
      userId: createdUser.userId,
      username: createdUser.username,
      role: "demo",
    };

    // First, demo user has no workspace membership, so no access
    const accessibleBefore =
      await authzService.getAccessibleRepositoryIds(demoUser);
    assertEquals(
      accessibleBefore?.length,
      0,
      "demo user with no membership should have no access",
    );

    // Get the demo workspace
    const demoWorkspace = await workspaceRepo.getDemoWorkspace();
    assert(demoWorkspace, "demo workspace should exist");

    // Add demo user to demo workspace
    await workspaceRepo.addUserToWorkspace(
      demoWorkspace.workspaceId,
      createdUser.userId,
      "member",
    );

    const insertedRepo = await sql<
      { repository_id: number }[]
    >`INSERT INTO repository (org, name)
      VALUES (${`demo-org-${crypto.randomUUID().slice(0, 8)}`}, ${`demo-repo-${crypto
        .randomUUID()
        .slice(0, 8)}`})
      RETURNING repository_id`;
    const demoRepoId = Number(insertedRepo[0].repository_id);

    await workspaceRepo.addRepositoryToWorkspace(
      demoWorkspace.workspaceId,
      demoRepoId,
      null,
    );

    // Now demo user should have access to demo workspace repos
    const accessibleAfter =
      await authzService.getAccessibleRepositoryIds(demoUser);
    assert(accessibleAfter !== null, "should return array, not null");
    assert(accessibleAfter.includes(demoRepoId), "demo repo should be visible");

    const canAccessDemoRepo = await authzService.canAccessRepositoryById(
      demoUser,
      demoRepoId,
    );
    assertEquals(canAccessDemoRepo, true, "demo user should access demo repo");

    const canAccessUnknownRepo = await authzService.canAccessRepositoryById(
      demoUser,
      999999,
    );
    assertEquals(
      canAccessUnknownRepo,
      false,
      "demo user should not access random repo",
    );
  });

  it("user can access repos in workspaces they belong to", async () => {
    const { connectionString } = await getTestDatabase();
    const sql = createSqlClient(connectionString);
    const workspaceRepo = new PostgresWorkspaceRepository(sql);
    const authzService = new AuthorizationService(workspaceRepo);

    // Create a real user in the database
    const authRepo = new PostgresAuthRepository(sql);
    const identityService = new AuthenticationIdentityService(authRepo, {
      passwordPepper: TEST_PEPPER,
    });
    await identityService.initialize();

    const username = `user-${crypto.randomUUID().slice(0, 8)}`;
    const createdUser = await identityService.createUser(
      username,
      "TestPass123!",
      "user",
    );

    const user: AuthUser = {
      userId: createdUser.userId,
      username: createdUser.username,
      role: "user",
    };

    // Create a workspace for this user (use NULL for created_by to avoid FK issues)
    const workspace = await workspaceRepo.createWorkspace(
      "Test User Workspace",
      `test-user-${createdUser.userId.slice(0, 8)}`,
      "user",
      null, // Use null for created_by in tests
    );

    // Add user as owner
    await workspaceRepo.addUserToWorkspace(
      workspace.workspaceId,
      createdUser.userId,
      "owner",
    );

    // User should have access to their workspace's repos (none yet)
    const accessibleBefore =
      await authzService.getAccessibleRepositoryIds(user);
    assert(accessibleBefore !== null, "should return array");

    // Get user's workspaces
    const userWorkspaces = await authzService.getUserWorkspaces(user);
    assert(
      userWorkspaces.length >= 1,
      "user should be in at least one workspace",
    );
    assertEquals(userWorkspaces[0].name, "Test User Workspace");
  });

  it("user cannot access repos outside their workspace", async () => {
    const { connectionString } = await getTestDatabase();
    const sql = createSqlClient(connectionString);
    const workspaceRepo = new PostgresWorkspaceRepository(sql);
    const authzService = new AuthorizationService(workspaceRepo);

    // Create real users in the database
    const authRepo = new PostgresAuthRepository(sql);
    const identityService = new AuthenticationIdentityService(authRepo, {
      passwordPepper: TEST_PEPPER,
    });
    await identityService.initialize();

    const usernameA = `user-a-${crypto.randomUUID().slice(0, 8)}`;
    const usernameB = `user-b-${crypto.randomUUID().slice(0, 8)}`;
    const createdUserA = await identityService.createUser(
      usernameA,
      "TestPass123!",
      "user",
    );
    const createdUserB = await identityService.createUser(
      usernameB,
      "TestPass123!",
      "user",
    );

    const userA: AuthUser = {
      userId: createdUserA.userId,
      username: createdUserA.username,
      role: "user",
    };
    const userB: AuthUser = {
      userId: createdUserB.userId,
      username: createdUserB.username,
      role: "user",
    };

    // Create workspace for user A (use null for created_by)
    const workspaceA = await workspaceRepo.createWorkspace(
      "User A Workspace",
      `user-a-ws-${createdUserA.userId.slice(0, 8)}`,
      "user",
      null,
    );
    await workspaceRepo.addUserToWorkspace(
      workspaceA.workspaceId,
      createdUserA.userId,
      "owner",
    );

    // Create workspace for user B (use null for created_by)
    const workspaceB = await workspaceRepo.createWorkspace(
      "User B Workspace",
      `user-b-ws-${createdUserB.userId.slice(0, 8)}`,
      "user",
      null,
    );
    await workspaceRepo.addUserToWorkspace(
      workspaceB.workspaceId,
      createdUserB.userId,
      "owner",
    );

    const insertedRepoA = await sql<
      { repository_id: number }[]
    >`INSERT INTO repository (org, name)
      VALUES (${`org-a-${crypto.randomUUID().slice(0, 8)}`}, ${`repo-a-${crypto
        .randomUUID()
        .slice(0, 8)}`})
      RETURNING repository_id`;
    const insertedRepoB = await sql<
      { repository_id: number }[]
    >`INSERT INTO repository (org, name)
      VALUES (${`org-b-${crypto.randomUUID().slice(0, 8)}`}, ${`repo-b-${crypto
        .randomUUID()
        .slice(0, 8)}`})
      RETURNING repository_id`;
    const repoAId = insertedRepoA[0].repository_id;
    const repoBId = insertedRepoB[0].repository_id;

    await workspaceRepo.addRepositoryToWorkspace(
      workspaceA.workspaceId,
      repoAId,
      null,
    );
    await workspaceRepo.addRepositoryToWorkspace(
      workspaceB.workspaceId,
      repoBId,
      null,
    );

    // User A should only see their workspace
    const userAWorkspaces = await authzService.getUserWorkspaces(userA);
    const userBWorkspaces = await authzService.getUserWorkspaces(userB);

    assertEquals(userAWorkspaces.length, 1);
    assertEquals(userBWorkspaces.length, 1);
    assertEquals(userAWorkspaces[0].name, "User A Workspace");
    assertEquals(userBWorkspaces[0].name, "User B Workspace");

    const userARepoA = await authzService.canAccessRepositoryById(
      userA,
      repoAId,
    );
    const userARepoB = await authzService.canAccessRepositoryById(
      userA,
      repoBId,
    );
    const userBRepoA = await authzService.canAccessRepositoryById(
      userB,
      repoAId,
    );
    const userBRepoB = await authzService.canAccessRepositoryById(
      userB,
      repoBId,
    );

    assertEquals(userARepoA, true, "user A should access repo A");
    assertEquals(userARepoB, false, "user A should not access repo B");
    assertEquals(userBRepoA, false, "user B should not access repo A");
    assertEquals(userBRepoB, true, "user B should access repo B");
  });

  it("canImportRepositories returns correct values for roles", async () => {
    const { connectionString } = await getTestDatabase();
    const sql = createSqlClient(connectionString);
    const workspaceRepo = new PostgresWorkspaceRepository(sql);
    const authzService = new AuthorizationService(workspaceRepo);

    const superuser: AuthUser = {
      userId: "1",
      username: "super",
      role: "superuser",
    };
    const user: AuthUser = { userId: "2", username: "user", role: "user" };
    const demo: AuthUser = { userId: "3", username: "demo", role: "demo" };

    assertEquals(
      authzService.canImportRepositories(superuser),
      true,
      "superuser can import",
    );
    assertEquals(
      authzService.canImportRepositories(user),
      true,
      "user can import",
    );
    assertEquals(
      authzService.canImportRepositories(demo),
      false,
      "demo cannot import",
    );
  });

  it("service without workspace repository denies access by default", async () => {
    // Create service without workspace repository
    const authzService = new AuthorizationService();

    assertEquals(
      authzService.isInitialized(),
      false,
      "should not be initialized",
    );

    const user: AuthUser = { userId: "1", username: "test", role: "user" };

    // Should deny access when not initialized (safe default)
    const canAccess = await authzService.canAccessRepositoryById(user, 1);
    assertEquals(canAccess, false, "should deny access when not initialized");

    // Should return empty array when not initialized
    const accessible = await authzService.getAccessibleRepositoryIds(user);
    assertEquals(
      accessible?.length,
      0,
      "should return empty when not initialized",
    );

    // But superuser still bypasses
    const superuser: AuthUser = {
      userId: "2",
      username: "super",
      role: "superuser",
    };
    const superuserCanAccess = await authzService.canAccessRepositoryById(
      superuser,
      1,
    );
    assertEquals(superuserCanAccess, true, "superuser still bypasses");
  });
});
