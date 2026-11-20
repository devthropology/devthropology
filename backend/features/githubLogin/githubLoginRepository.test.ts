import { test } from "vitest";
import {
  deepStrictEqual as assertEquals,
  ok as assert,
  rejects as assertRejects,
} from "node:assert/strict";
import { getTestDatabase } from "../../testUtils/testDatabase.ts";
import { createSqlClient } from "../../repository/sqlClient.ts";
import { PostgresAuthRepository } from "../../repository/postgresAuthRepository.ts";
import { PostgresWorkspaceRepository } from "../../repository/postgresWorkspaceRepository.ts";
import { AuthenticationIdentityService } from "../../services/authenticationIdentityService.ts";
import { GithubLoginRepository } from "./githubLoginRepository.ts";

test("GitHub provisioning is unique, passwordless, workspace-isolated, and visible across auth instances", async () => {
  const { connectionString } = await getTestDatabase();
  const sql = createSqlClient(connectionString);
  const githubId = crypto.randomUUID();
  const login = `github-test-${crypto.randomUUID()}`;
  const createdIds: string[] = [];
  try {
    const authRepository = new PostgresAuthRepository(sql);
    const auth = new AuthenticationIdentityService(authRepository, {
      passwordPepper: "test",
      pbkdf2Iterations: 1,
    });
    const existing = await auth.createUser(
      `\t${login.toUpperCase()}\u00a0`,
      "password",
      "user",
    );
    createdIds.push(existing.userId);
    const otherInstance = new AuthenticationIdentityService(authRepository, {
      passwordPepper: "test",
      pbkdf2Iterations: 1,
    });
    await otherInstance.initialize(); // Simulate an instance already running before signup.
    const repository = new GithubLoginRepository(sql);
    const results = await Promise.all(
      Array.from({ length: 4 }, () => repository.provision(githubId, login)),
    );
    const account = results[0];
    assert(account);
    createdIds.push(account.userId);
    // Concurrent provisioning creates one account without merging.
    assertEquals(
      new Set(results.map((r) => r?.userId)).size,
      1,
      "Concurrent provisioning must return one account",
    );
    assertEquals(
      results.filter((r) => r?.isNew).length,
      1,
      "Only one concurrent provision may create the account",
    );
    assertEquals(account.role, "user");
    assert(
      account.userId !== existing.userId,
      "GitHub signup must not merge with the password account",
    );
    assert(account.username !== login);

    // Stable identity survives login renames and authenticates across instances.
    const renamed = await repository.provision(githubId, "renamed-login");
    assertEquals(
      renamed?.userId,
      account.userId,
      "A login rename must preserve account identity",
    );
    assertEquals(renamed?.token, account.token);
    assertEquals(
      (await otherInstance.validateToken(account.token))?.userId,
      account.userId,
    );
    assertEquals(await otherInstance.validateToken("not-a-uuid"), null);

    // GitHub accounts remain passwordless and existing password login works.
    const afterRestart = new AuthenticationIdentityService(authRepository, {
      passwordPepper: "test",
      pbkdf2Iterations: 1,
    });
    assertEquals(
      await afterRestart.authenticateWithPassword(account.username, "password"),
      null,
    );
    assertEquals(
      (await auth.authenticateWithPassword(login, "password"))?.user.userId,
      existing.userId,
    );

    // Personal workspace is owned and isolated.
    const workspaces = new PostgresWorkspaceRepository(sql);
    const owned = await workspaces.getUserWorkspaces(account.userId);
    assertEquals(owned.length, 1);
    assertEquals(owned[0].workspaceType, "user");
    const memberships =
      await sql`SELECT workspace_role FROM workspace_member WHERE auth_user_id = ${account.userId}`;
    assertEquals(memberships[0].workspace_role, "owner");
    assertEquals(
      await workspaces.getAccessibleRepositoryIds(account.userId),
      [],
    );
    assertEquals(
      await workspaces.isUserInWorkspace(existing.userId, owned[0].workspaceId),
      false,
    );
    assertEquals(
      await workspaces.canUserAccessRepository(account.userId, 1),
      false,
    );

    // Deactivation rejects token validation and repeat login.
    await sql`UPDATE auth_users SET is_active = FALSE WHERE auth_user_id = ${account.userId}`;
    assertEquals(
      await otherInstance.validateToken(account.token),
      null,
      "Deactivation must invalidate tokens across auth instances",
    );
    assertEquals(
      await repository.provision(githubId, login),
      null,
      "Repeat login must not reactivate a disabled account",
    );
  } finally {
    if (createdIds.length) {
      await sql`DELETE FROM workspace WHERE created_by IN ${sql(createdIds)}`;
    }
    await sql`DELETE FROM github_identity WHERE github_user_id = ${githubId}`;
    if (createdIds.length) {
      await sql`DELETE FROM auth_users WHERE auth_user_id IN ${sql(
        createdIds,
      )}`;
    }
    await sql.end();
  }
});

test("Normalized username uniqueness rejects password creation from a stale cache after GitHub signup", async () => {
  const { connectionString } = await getTestDatabase();
  const sql = createSqlClient(connectionString);
  const githubId = crypto.randomUUID();
  const login = `stale-${githubId}`;
  let userId: string | undefined;
  try {
    const staleService = new AuthenticationIdentityService(
      new PostgresAuthRepository(sql),
      {
        passwordPepper: "test",
        pbkdf2Iterations: 1,
      },
    );
    await staleService.initialize();
    const account = await new GithubLoginRepository(sql).provision(
      githubId,
      login,
    );
    assert(account);
    userId = account.userId;
    assertEquals(account.username, login);
    await assertRejects(
      () =>
        staleService.createUser(
          `\t${login.toUpperCase()}\u00a0`,
          "password",
          "user",
        ),
      { code: "23505" },
    );
    const rows =
      await sql`SELECT auth_user_id FROM auth_users WHERE auth_normalized_username(username) = ${login}`;
    assertEquals(rows.length, 1);
    assertEquals(rows[0].auth_user_id, userId);
  } finally {
    if (userId) {
      await sql`DELETE FROM workspace WHERE created_by = ${userId}`;
      await sql`DELETE FROM github_identity WHERE github_user_id = ${githubId}`;
      await sql`DELETE FROM auth_users WHERE auth_user_id = ${userId}`;
    }
    await sql.end();
  }
});

test("GitHub login attempts enforce expiry, browser binding, and atomic single consumption", async () => {
  const { connectionString } = await getTestDatabase();
  const sql = createSqlClient(connectionString);
  const repository = new GithubLoginRepository(sql);
  const state = crypto.randomUUID();
  try {
    await repository.saveAttempt(state, "browser", "verifier", "/app");
    assertEquals(await repository.consumeAttempt(state, "wrong-browser"), null);
    const attempts = await Promise.all([
      repository.consumeAttempt(state, "browser"),
      repository.consumeAttempt(state, "browser"),
    ]);
    assertEquals(attempts.filter(Boolean).length, 1);
    await repository.saveAttempt(state, "browser", "verifier", "/app");
    await sql`UPDATE github_login_attempt SET expires_at = now() - interval '1 second' WHERE state_hash = ${state}`;
    assertEquals(await repository.consumeAttempt(state, "browser"), null);
  } finally {
    await sql`DELETE FROM github_login_attempt WHERE state_hash = ${state}`;
    await sql.end();
  }
});
