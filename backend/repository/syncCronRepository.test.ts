import { afterEach, beforeEach, describe, it } from "vitest";
import {
  deepStrictEqual as assertEquals,
  ok as assert,
} from "node:assert/strict";
import { getTestDatabase } from "../testUtils/testDatabase.ts";
import { RepositoryRepository } from "./repositoryRepository.ts";
import { createSqlClient } from "./sqlClient.ts";
import { SyncRepository } from "./syncRepository.ts";
import { SyncCronRepository } from "./syncCronRepository.ts";

describe("SyncCronRepository", () => {
  let syncCronRepository: SyncCronRepository;
  let syncRepository: SyncRepository;
  let repositoryRepository: RepositoryRepository;
  let connectionString: string;
  let cleanupSql: ReturnType<typeof createSqlClient>;
  let createdRepositoryIds: number[];
  let createdApiKeys: string[];

  beforeEach(async () => {
    const testDb = await getTestDatabase();
    connectionString = testDb.connectionString;
    cleanupSql = createSqlClient(connectionString);
    syncCronRepository = new SyncCronRepository(
      createSqlClient(connectionString),
    );
    syncRepository = new SyncRepository(createSqlClient(connectionString));
    repositoryRepository = new RepositoryRepository(
      createSqlClient(connectionString),
    );
    createdRepositoryIds = [];
    createdApiKeys = [];
  });

  afterEach(async () => {
    if (createdRepositoryIds.length > 0) {
      await cleanupSql`
        DELETE FROM repository
        WHERE repository_id IN ${cleanupSql(createdRepositoryIds)}
      `;
    }

    if (createdApiKeys.length > 0) {
      await cleanupSql`
        DELETE FROM sync_api_keys
        WHERE api_key IN ${cleanupSql(createdApiKeys)}
      `;
    }

    await syncCronRepository.close();
    await syncRepository.close();
    await repositoryRepository.close();
    await cleanupSql.end({ timeout: 1 });
  });

  it("stores cron repositories, api key mappings, and latest runs", async () => {
    const repoA = await repositoryRepository.insertRepository(
      `cron-org-${crypto.randomUUID()}`,
      `repo-a-${crypto.randomUUID()}`,
    );
    const repoB = await repositoryRepository.insertRepository(
      `cron-org-${crypto.randomUUID()}`,
      `repo-b-${crypto.randomUUID()}`,
    );
    createdRepositoryIds.push(repoA.repository_id, repoB.repository_id);

    const apiKeyValue = `token-${crypto.randomUUID()}`;
    const key = await syncRepository.insertApiKey({
      apiKey: apiKeyValue,
      ghUsername: `gh-${crypto.randomUUID()}`,
    });
    createdApiKeys.push(apiKeyValue);

    const cronRepoA = await syncCronRepository.upsertRepository({
      repositoryId: repoA.repository_id,
      batchSize: 500,
    });
    await syncCronRepository.upsertRepository({
      repositoryId: repoB.repository_id,
      batchSize: 250,
    });
    await syncCronRepository.upsertRepositoryApiKey({
      syncCronRepositoryId: cronRepoA.sync_cron_repository_id,
      syncApiKeyId: key.sync_api_key_id,
    });

    const repositories = await syncCronRepository.getActiveRepositories();
    const createdRepositories = repositories.filter((repository) =>
      [repoA.repository_id, repoB.repository_id].includes(
        repository.repository_id,
      ),
    );

    assertEquals(
      createdRepositories
        .map((repository) => repository.repository_id)
        .sort((a, b) => a - b),
      [repoA.repository_id, repoB.repository_id].sort((a, b) => a - b),
    );

    const apiKeys = await syncCronRepository.getApiKeysForRepository(
      cronRepoA.sync_cron_repository_id,
    );
    assertEquals(apiKeys.length, 1);
    assertEquals(apiKeys[0].sync_api_key_id, key.sync_api_key_id);

    const startedAt = new Date();
    const completedAt = new Date(startedAt.getTime() + 1_000);
    const run = await syncCronRepository.insertRun({
      syncCronRepositoryId: cronRepoA.sync_cron_repository_id,
      outcomeCode: "PARTIAL_RATE_LIMIT",
      requestedCount: 500,
      processedCount: 320,
      apiKeysUsed: 2,
      startedAt,
      completedAt,
    });

    assertEquals(run.outcome_code, "PARTIAL_RATE_LIMIT");
    assertEquals(run.processed_count, 320);

    const latestRun = await syncCronRepository.getLatestRun();
    assert(latestRun, "Expected a latest run to be returned.");
    assertEquals(latestRun?.sync_cron_run_id, run.sync_cron_run_id);
  });
});
