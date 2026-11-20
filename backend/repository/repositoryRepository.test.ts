import { afterEach, beforeEach, describe, it } from "vitest";
import {
  deepStrictEqual as assertEquals,
  rejects as assertRejects,
} from "node:assert/strict";
import { RepositoryRepository } from "./repositoryRepository.ts";
import { getTestDatabase } from "../testUtils/testDatabase.ts";
import { createSqlClient } from "./sqlClient.ts";

describe("RepositoryRepository", () => {
  let repository: RepositoryRepository;
  let sql: ReturnType<typeof createSqlClient> | undefined;
  let testId: string;

  beforeEach(async () => {
    const testDb = await getTestDatabase();
    sql = createSqlClient(testDb.connectionString);
    repository = new RepositoryRepository(sql);
    testId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  });

  afterEach(async () => {
    await sql?.end();
    sql = undefined;
  });

  describe("insertRepository", () => {
    it("should throw error for duplicate repository", async () => {
      const org = `testorg${testId}dup`;
      const name = `testrepo${testId}dup`;
      // First insert
      await repository.insertRepository(org, name);

      // Try to insert again
      await assertRejects(
        async () => {
          await repository.insertRepository(org, name);
        },
        (error: unknown) =>
          error instanceof Error &&
          error.message.includes(
            "duplicate key value violates unique constraint",
          ),
      );
    });
  });

  describe("getAllRepositories", () => {
    it("should include existing repositories", async () => {
      const repositories = await repository.getAllRepositories();
      // Test database should have at least the tailscale repository
      assertEquals(repositories.length >= 1, true);
      const tailscaleRepo = repositories.find(
        (repo) => repo.org === "tailscale" && repo.name === "tailscale",
      );
      assertEquals(tailscaleRepo?.repository_id, 1);
    });
  });
});
