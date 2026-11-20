import { test } from "vitest";
import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { PostgresWorkspaceRepository } from "./postgresWorkspaceRepository.ts";
import type { SqlClient } from "./sqlClient.ts";

test("workspace repository normalizes Postgres string repository IDs to numbers", async () => {
  const sql = (() =>
    Promise.resolve([
      { repository_id: "16" },
      { repository_id: 17 },
    ])) as unknown as SqlClient;
  const repository = new PostgresWorkspaceRepository(sql);

  assertEquals(
    await repository.getWorkspaceRepositories("workspace-id"),
    [16, 17],
  );
});
