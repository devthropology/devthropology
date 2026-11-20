import {
  deepStrictEqual as assertEquals,
  ok as assert,
} from "node:assert/strict";
import { describe, it } from "vitest";
import { getTestDatabase } from "../testUtils/testDatabase.ts";
import { PostgresAuthRepository } from "../repository/postgresAuthRepository.ts";
import { AuthenticationIdentityService } from "./authenticationIdentityService.ts";
import { createSqlClient } from "../repository/sqlClient.ts";

const TEST_PEPPER = "test-pepper";

describe("AuthenticationIdentityService", () => {
  it("creates users, authenticates with permanent tokens", async () => {
    const { connectionString } = await getTestDatabase();
    const authRepo = new PostgresAuthRepository(
      createSqlClient(connectionString),
    );
    const identityService = new AuthenticationIdentityService(authRepo, {
      passwordPepper: TEST_PEPPER,
    });

    await identityService.initialize();

    const username = `alice-${crypto.randomUUID()}`;
    const password = "VeryStrongPassw0rd!";

    const createdUser = await identityService.createUser(
      username,
      password,
      "admin",
    );

    assertEquals(createdUser.username.toLowerCase(), username.toLowerCase());
    assertEquals(createdUser.role, "admin");

    const authResult = await identityService.authenticateWithPassword(
      username,
      password,
    );

    assert(authResult, "authentication result should exist");
    assertEquals(
      authResult.user.username.toLowerCase(),
      username.toLowerCase(),
    );
    assert(authResult.token.length > 20, "token should be present");

    const lookedUp = await identityService.validateToken(authResult.token);
    assert(lookedUp, "token lookup should resolve user");
    assertEquals(lookedUp.username.toLowerCase(), username.toLowerCase());

    // Token should remain valid even after multiple authentications
    const authResult2 = await identityService.authenticateWithPassword(
      username,
      password,
    );
    assertEquals(
      authResult2?.token,
      authResult.token,
      "token should be permanent",
    );

    await authRepo.close();
  });

  it("rejects unknown users and invalid passwords", async () => {
    const { connectionString } = await getTestDatabase();
    const authRepo = new PostgresAuthRepository(
      createSqlClient(connectionString),
    );
    const identityService = new AuthenticationIdentityService(authRepo, {
      passwordPepper: TEST_PEPPER,
    });

    await identityService.initialize();

    const username = `bob-${crypto.randomUUID()}`;
    const password = "Sup3rSecretPass!";

    await identityService.createUser(username, password, "user");

    const wrongPasswordResult = await identityService.authenticateWithPassword(
      username,
      "wrong-password",
    );
    assertEquals(wrongPasswordResult, null);

    const unknownUserResult = await identityService.authenticateWithPassword(
      "unknown-user",
      "whatever",
    );
    assertEquals(unknownUserResult, null);

    await authRepo.close();
  });
});
