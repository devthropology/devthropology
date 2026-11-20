import { test } from "vitest";
import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { buildSyncJobs } from "./scheduling.ts";
import { SyncRepositoryWithDetails } from "../models/sync/syncRepository.ts";
import { SyncApiKey } from "../models/sync/syncApiKey.ts";

test("LAST_SEEN repositories fan out across all keys", () => {
  const repository: SyncRepositoryWithDetails = {
    sync_repository_id: 1,
    repository_id: 42,
    sync_mode_id: 1,
    num_to_sync: 5,
    active: true,
    inserted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    mode_code: "LAST_SEEN",
    org: "example",
    name: "repo",
  };

  const apiKeys: SyncApiKey[] = [
    {
      sync_api_key_id: 1,
      api_key: "token-a",
      gh_username: "alice",
      active: true,
      inserted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      sync_api_key_id: 2,
      api_key: "token-b",
      gh_username: "bob",
      active: true,
      inserted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      sync_api_key_id: 3,
      api_key: "token-c",
      gh_username: "carol",
      active: true,
      inserted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const jobs = buildSyncJobs([repository], apiKeys);
  assertEquals(jobs.length, apiKeys.length);
  assertEquals(
    jobs.map((job) => job.apiKey.sync_api_key_id),
    [1, 2, 3],
  );
  assertEquals(
    jobs.map((job) => job.usageNumber),
    [1, 2, 3],
  );
  assertEquals(
    jobs.map((job) => job.usageTotal),
    [3, 3, 3],
  );
});

test("LATEST_ISSUES repositories run once with a single key", () => {
  const repository: SyncRepositoryWithDetails = {
    sync_repository_id: 2,
    repository_id: 99,
    sync_mode_id: 2,
    num_to_sync: 10,
    active: true,
    inserted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    mode_code: "LATEST_ISSUES",
    org: "example",
    name: "repo2",
  };

  const apiKeys: SyncApiKey[] = [
    {
      sync_api_key_id: 1,
      api_key: "token-a",
      gh_username: "alice",
      active: true,
      inserted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      sync_api_key_id: 2,
      api_key: "token-b",
      gh_username: "bob",
      active: true,
      inserted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const jobs = buildSyncJobs([repository], apiKeys);
  assertEquals(jobs.length, 1);
  assertEquals(jobs[0].apiKey.sync_api_key_id, 1);
  assertEquals(jobs[0].usageNumber, 1);
  assertEquals(jobs[0].usageTotal, 1);
});

test("Mixed modes rotate keys after LAST_SEEN fan-out", () => {
  const lastSeen: SyncRepositoryWithDetails = {
    sync_repository_id: 1,
    repository_id: 101,
    sync_mode_id: 1,
    num_to_sync: 5,
    active: true,
    inserted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    mode_code: "LAST_SEEN",
    org: "example",
    name: "last",
  };
  const latest: SyncRepositoryWithDetails = {
    sync_repository_id: 2,
    repository_id: 102,
    sync_mode_id: 2,
    num_to_sync: 5,
    active: true,
    inserted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    mode_code: "LATEST_ISSUES",
    org: "example",
    name: "latest",
  };

  const apiKeys: SyncApiKey[] = [
    {
      sync_api_key_id: 1,
      api_key: "token-a",
      gh_username: "alice",
      active: true,
      inserted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      sync_api_key_id: 2,
      api_key: "token-b",
      gh_username: "bob",
      active: true,
      inserted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      sync_api_key_id: 3,
      api_key: "token-c",
      gh_username: "carol",
      active: true,
      inserted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const jobs = buildSyncJobs([lastSeen, latest], apiKeys);
  assertEquals(jobs.length, 4);
  assertEquals(
    jobs.map((job) => job.apiKey.sync_api_key_id),
    [1, 2, 3, 2],
  );
  assertEquals(jobs[3].target.mode_code, "LATEST_ISSUES");
  assertEquals(jobs[3].usageNumber, 1);
  assertEquals(jobs[3].usageTotal, 1);
});
