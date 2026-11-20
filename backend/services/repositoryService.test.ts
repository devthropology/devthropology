import { afterEach, beforeEach, describe, it } from "vitest";
import {
  deepStrictEqual as assertEquals,
  rejects as assertRejects,
} from "node:assert/strict";
import { RepositoryService } from "./repositoryService.ts";
import { RepositoryRepository } from "../repository/repositoryRepository.ts";
import { getTestDatabase } from "../testUtils/testDatabase.ts";
import { createSqlClient } from "../repository/sqlClient.ts";

describe("RepositoryService", () => {
  let repository: RepositoryRepository;
  let service: RepositoryService;
  let sql: ReturnType<typeof createSqlClient> | undefined;
  let testId: string;

  beforeEach(async () => {
    const testDb = await getTestDatabase();
    sql = createSqlClient(testDb.connectionString);
    repository = new RepositoryRepository(sql);
    service = new RepositoryService(repository);
    testId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  });

  afterEach(async () => {
    await sql?.end();
    sql = undefined;
  });

  describe("onboardRepository", () => {
    it("should insert a new repository successfully", async () => {
      const org = `testorg${testId}`;
      const name = `testrepo${testId}`;
      const result = await service.onboardRepository(org, name);

      assertEquals(result.org, org);
      assertEquals(result.name, name);
      assertEquals(typeof result.repository_id, "number");
    });

    it("should throw error for duplicate repository", async () => {
      const org = `testorg${testId}dup`;
      const name = `testrepo${testId}dup`;
      // First insert
      await service.onboardRepository(org, name);

      // Try to insert again
      await assertRejects(
        async () => {
          await service.onboardRepository(org, name);
        },
        (error: unknown) =>
          error instanceof Error &&
          error.message.includes(`Repository ${org}/${name} already exists`),
      );
    });

    it("should throw error for invalid input", async () => {
      await assertRejects(
        async () => {
          await service.onboardRepository("", `testrepo${testId}invalid1`);
        },
        (error: unknown) =>
          error instanceof Error &&
          error.message.includes(
            "Organization and repository name are required",
          ),
      );

      await assertRejects(
        async () => {
          await service.onboardRepository(`testorg${testId}invalid2`, "");
        },
        (error: unknown) =>
          error instanceof Error &&
          error.message.includes(
            "Organization and repository name are required",
          ),
      );

      await assertRejects(
        async () => {
          await service.onboardRepository(
            `test/org${testId}invalid3`,
            `testrepo${testId}invalid3`,
          );
        },
        (error: unknown) =>
          error instanceof Error &&
          error.message.includes(
            "Organization and repository name cannot contain slashes",
          ),
      );
    });
  });

  describe("getAllRepositories", () => {
    it("should return all repositories", async () => {
      const org1 = `org${testId}101`;
      const name1 = `repo${testId}101`;
      const org2 = `org${testId}202`;
      const name2 = `repo${testId}202`;

      // Insert some test repositories
      await service.onboardRepository(org1, name1);
      await service.onboardRepository(org2, name2);

      const repositories = await service.getAllRepositories();

      // Should include the test repositories plus existing ones
      assertEquals(repositories.length >= 3, true);
      const repo1 = repositories.find(
        (r) => r.org === org1 && r.name === name1,
      );
      const repo2 = repositories.find(
        (r) => r.org === org2 && r.name === name2,
      );

      assertEquals(repo1?.org, org1);
      assertEquals(repo1?.name, name1);
      assertEquals(repo2?.org, org2);
      assertEquals(repo2?.name, name2);
    });
  });
});
