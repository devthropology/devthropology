import { test } from "vitest";
import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { orderRepositoriesForRun } from "./syncCron.ts";
import { SyncCronRepositoryWithDetails } from "../models/syncCron/syncCronRepository.ts";

function buildRepository(
  syncCronRepositoryId: number,
  repositoryId: number,
): SyncCronRepositoryWithDetails {
  return {
    sync_cron_repository_id: syncCronRepositoryId,
    repository_id: repositoryId,
    batch_size: 500,
    active: true,
    inserted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    org: "example",
    name: `repo-${repositoryId}`,
  };
}

test("orderRepositoriesForRun retries the last partial repository first", () => {
  const repositories = [
    buildRepository(10, 1),
    buildRepository(11, 2),
    buildRepository(12, 3),
  ];

  const ordered = orderRepositoriesForRun(repositories, {
    sync_cron_repository_id: 11,
    outcome_code: "PARTIAL_RATE_LIMIT",
  });

  assertEquals(
    ordered.map((repository) => repository.repository_id),
    [2, 3, 1],
  );
});

test("orderRepositoriesForRun advances after a complete repository", () => {
  const repositories = [
    buildRepository(10, 1),
    buildRepository(11, 2),
    buildRepository(12, 3),
  ];

  const ordered = orderRepositoriesForRun(repositories, {
    sync_cron_repository_id: 11,
    outcome_code: "COMPLETE",
  });

  assertEquals(
    ordered.map((repository) => repository.repository_id),
    [3, 1, 2],
  );
});

test("orderRepositoriesForRun wraps to the first repository after the end", () => {
  const repositories = [
    buildRepository(10, 1),
    buildRepository(11, 2),
    buildRepository(12, 3),
  ];

  const ordered = orderRepositoriesForRun(repositories, {
    sync_cron_repository_id: 12,
    outcome_code: "COMPLETE",
  });

  assertEquals(
    ordered.map((repository) => repository.repository_id),
    [1, 2, 3],
  );
});
