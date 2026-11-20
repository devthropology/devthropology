import { test } from "vitest";
import {
  deepStrictEqual as assertEquals,
  throws as assertThrows,
} from "node:assert/strict";
import {
  parseDeleteArgs,
  repositoryDeletionScopes,
} from "./deleteRepository.ts";

test("deleteRepository defaults to dry-run", () => {
  assertEquals(parseDeleteArgs(["calcom/cal.com"]), {
    org: "calcom",
    repo: "cal.com",
    wetRun: false,
  });
});

test("deleteRepository accepts wet-run in either position", () => {
  const expected = { org: "openai", repo: "openai-agents-js", wetRun: true };
  assertEquals(
    parseDeleteArgs(["openai/openai-agents-js", "--wet-run"]),
    expected,
  );
  assertEquals(
    parseDeleteArgs(["--wet-run", "openai/openai-agents-js"]),
    expected,
  );
});

test("deleteRepository rejects malformed targets and unknown flags", () => {
  for (const args of [
    [],
    ["calcom"],
    ["/cal.com"],
    ["calcom/"],
    ["a/b/c"],
    ["calcom/cal.com", "--wetrun"],
    ["a/b", "c/d"],
    ["a/b", "--wet-run", "--wet-run"],
    ["a/b';DELETE"],
  ]) {
    assertThrows(() => parseDeleteArgs(args));
  }
});

test("deletion scopes include sync metadata but exclude shared entities", () => {
  const scopes = repositoryDeletionScopes();
  const tables = scopes.map(({ table }) => table);
  assertEquals(tables.length, new Set(tables).size);
  for (const table of [
    "sync_repositories",
    "sync_cron_repositories",
    "sync_cron_runs",
    "sync_cron_repository_api_keys",
    "issue_backfill",
    "team_members",
    "workspace_repository",
    "computed_pull_request_metrics",
  ]) {
    assertEquals(tables.includes(table), true);
  }
  for (const table of [
    "user",
    "github_user_profile",
    "sync_api_keys",
    "workspace",
    "auth_users",
  ]) {
    assertEquals(tables.includes(table), false);
  }
  for (const scope of scopes) assertEquals(scope.where.includes("$1"), true);
});
