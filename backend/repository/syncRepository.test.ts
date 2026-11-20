import { afterEach, beforeEach, describe, it } from "vitest";
import {
  deepStrictEqual as assertEquals,
  ok as assert,
} from "node:assert/strict";
import { SyncRepository } from "./syncRepository.ts";
import { getTestDatabase } from "../testUtils/testDatabase.ts";
import { RepositoryRepository } from "./repositoryRepository.ts";
import { createSqlClient } from "./sqlClient.ts";

describe("SyncRepository", () => {
  let syncRepository: SyncRepository;
  let repositoryRepository: RepositoryRepository;
  let connectionString: string;

  beforeEach(async () => {
    const testDb = await getTestDatabase();
    connectionString = testDb.connectionString;
    syncRepository = new SyncRepository(createSqlClient(connectionString));
    repositoryRepository = new RepositoryRepository(
      createSqlClient(connectionString),
    );
  });

  afterEach(async () => {
    await syncRepository.close();
    await repositoryRepository.close();
  });

  it("inserts and fetches active API keys", async () => {
    const ghUsername = `test-user-${crypto.randomUUID()}`;
    const apiKeyValue = `token-${crypto.randomUUID()}`;

    const inserted = await syncRepository.insertApiKey({
      apiKey: apiKeyValue,
      ghUsername,
    });

    assertEquals(inserted.api_key, apiKeyValue);
    assertEquals(inserted.gh_username, ghUsername);
    assertEquals(inserted.active, true);

    const activeKeys = await syncRepository.getActiveApiKeys();
    const found = activeKeys.find((key) => key.api_key === apiKeyValue);

    assert(
      found,
      "Expected inserted API key to be returned among active keys.",
    );
    assertEquals(found?.gh_username, ghUsername);
  });

  it("inserts repositories to sync and fetches them", async () => {
    const org = `sync-org-${crypto.randomUUID()}`;
    const name = `sync-repo-${crypto.randomUUID()}`;
    const repository = await repositoryRepository.insertRepository(org, name);

    const syncRecord = await syncRepository.insertRepositoryToSync({
      repositoryId: repository.repository_id,
      syncModeCode: "LAST_SEEN",
      numToSync: 25,
    });

    assertEquals(syncRecord.repository_id, repository.repository_id);
    assertEquals(syncRecord.num_to_sync, 25);

    const targets = await syncRepository.getRepositoriesToSync();
    const target = targets.find(
      (item) =>
        item.repository_id === repository.repository_id &&
        item.mode_code === "LAST_SEEN",
    );

    assert(target, "Expected repository to be included in sync targets.");
    assertEquals(target?.org, org);
    assertEquals(target?.name, name);
    assertEquals(target?.num_to_sync, 25);
  });

  it("inserts sync jobs", async () => {
    const org = `job-org-${crypto.randomUUID()}`;
    const name = `job-repo-${crypto.randomUUID()}`;
    const repository = await repositoryRepository.insertRepository(org, name);

    const apiKey = await syncRepository.insertApiKey({
      apiKey: `token-${crypto.randomUUID()}`,
      ghUsername: `gh-${crypto.randomUUID()}`,
    });

    await syncRepository.insertRepositoryToSync({
      repositoryId: repository.repository_id,
      syncModeCode: "LATEST_ISSUES",
      numToSync: 10,
    });

    const startedAt = new Date();
    const completedAt = new Date(startedAt.getTime() + 1_500);

    const job = await syncRepository.insertSyncJob({
      repositoryId: repository.repository_id,
      syncModeCode: "LATEST_ISSUES",
      syncApiKeyId: apiKey.sync_api_key_id,
      durationSeconds: 2,
      startedAt,
      completedAt,
    });

    assertEquals(job.repository_id, repository.repository_id);
    assertEquals(job.sync_api_key_id, apiKey.sync_api_key_id);
    assertEquals(job.duration_seconds, 2);
    assert(job.sync_mode_id !== null, "Expected sync mode id to be recorded.");
  });
});
