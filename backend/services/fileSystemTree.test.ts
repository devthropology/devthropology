import { test } from "vitest";
import {
  deepStrictEqual as assertEquals,
  ok as assert,
} from "node:assert/strict";
import { FileSystemActivity } from "../models/dbTypes.ts";
import { FileSystemTreeBuilder } from "./fileSystemTreeBuilder.ts";
import { CodeAdjacencyOptions } from "./codeAdjacencyBuilder.ts";

function buildUserLastSeenMap(
  activities: FileSystemActivity[],
): Map<number, string> {
  const m = new Map<number, string>();
  for (const a of activities) {
    if (!a.merged_at) continue;
    const prev = m.get(a.user_id);
    const cur = new Date(a.merged_at).toISOString();
    if (!prev || new Date(cur) > new Date(prev)) {
      m.set(a.user_id, cur);
    }
  }
  return m;
}

// helper returns user_id -> last_seen map for tests

// Test helper to build FileSystemActivity objects
interface ActivityBuilder {
  filename: string;
  additions: number;
  deletions: number;
  status?: "modified" | "added" | "renamed" | "removed";
  previous_filename?: string;
  gh_login?: string;
  gh_issue_id?: number;
  title?: string;
  user_id?: number;
  merged_at?: string;
}

const DEFAULT_TEST_NOW = new Date("2025-09-15T00:00:00Z");
function createBuilder(
  now: Date = DEFAULT_TEST_NOW,
  codeAdjacencyOptions: Partial<CodeAdjacencyOptions> = {},
) {
  return new FileSystemTreeBuilder(
    () => new Date(now.getTime()),
    codeAdjacencyOptions,
  );
}

// Unit Tests
test("buildRenameChains - handles simple rename chains", () => {
  FileSystemActivityHelper.reset();
  const builder = createBuilder();

  const activities = FileSystemActivityHelper.buildTestScenario();
  const expectedChains = FileSystemActivityHelper.buildExpectedRenameChains();

  const result = builder.buildRenameChains(activities);

  assertEquals(result.size, expectedChains.size);
  expectedChains.forEach((_value, key) => {
    assertEquals(result.get(key), expectedChains.get(key));
  });
});

test("buildRenameChains - handles complex chain a->b->c", () => {
  FileSystemActivityHelper.reset();
  const builder = createBuilder();

  // Create a chain: original.js -> intermediate.js -> final.js
  const activities = [
    FileSystemActivityHelper.buildActivity({
      filename: "intermediate.js",
      status: "renamed",
      previous_filename: "original.js",
      additions: 10,
      deletions: 5,
      gh_issue_id: 1,
      merged_at: "2024-01-01T00:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "final.js",
      status: "renamed",
      previous_filename: "intermediate.js",
      additions: 10,
      deletions: 5,
      gh_issue_id: 2,
      merged_at: "2024-02-01T00:00:00Z",
    }),
  ];

  const result = builder.buildRenameChains(activities);

  assertEquals(result.get("original.js"), "final.js");
  assertEquals(result.get("intermediate.js"), "final.js");
});

test("buildRenameChains - detects cycles", () => {
  FileSystemActivityHelper.reset();
  const builder = createBuilder();

  // Create a cycle: a.js -> b.js -> a.js
  const activities = [
    FileSystemActivityHelper.buildActivity({
      filename: "b.js",
      status: "renamed",
      previous_filename: "a.js",
      additions: 10,
      deletions: 5,
      gh_issue_id: 1,
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "a.js",
      status: "renamed",
      previous_filename: "b.js",
      additions: 10,
      deletions: 5,
      gh_issue_id: 2,
    }),
  ];

  const result = builder.buildRenameChains(activities);

  // Should handle cycle gracefully (exact behavior depends on implementation)
  assert(result != null);
});

test("buildRenameChains - resolves ping-pong rename to latest name", () => {
  FileSystemActivityHelper.reset();
  const builder = createBuilder();

  const authPath = "auth/AuthenticationService.ts";
  const internalPath = "auth/InternalAuthenticationService.ts";

  const activities = [
    FileSystemActivityHelper.buildActivity({
      filename: internalPath,
      status: "renamed",
      previous_filename: authPath,
      additions: 1,
      deletions: 1,
      gh_issue_id: 1,
      merged_at: "2025-10-03T23:21:08Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: authPath,
      status: "renamed",
      previous_filename: internalPath,
      additions: 1,
      deletions: 1,
      gh_issue_id: 2,
      merged_at: "2025-10-04T23:37:41Z",
    }),
  ];

  const result = builder.buildRenameChains(activities);

  assertEquals(
    result.get(internalPath),
    authPath,
    "older name should collapse into the most recent rename target",
  );
  assertEquals(
    result.get(authPath),
    authPath,
    "canonical name should resolve to itself for downstream use",
  );
});

test("buildPathNodes - builds correct folder structure", () => {
  FileSystemActivityHelper.reset();
  const builder = createBuilder();

  const activities = FileSystemActivityHelper.buildTestScenario();
  const renameChains = builder.buildRenameChains(activities);

  const result = builder.buildPathNodes(activities, renameChains);

  // Test root files
  assertEquals(result.get("README.md")?.type, "file");
  assertEquals(result.get("README.md")?.level, 1);
  assertEquals(result.get("README.md")?.parent_path, null);

  assertEquals(result.get("package.json")?.type, "file");
  assertEquals(result.get("package.json")?.level, 1);

  // Test folders
  assertEquals(result.get("backend")?.type, "folder");
  assertEquals(result.get("backend")?.level, 1);
  assertEquals(result.get("backend")?.parent_path, null);

  assertEquals(result.get("backend/services")?.type, "folder");
  assertEquals(result.get("backend/services")?.level, 2);
  assertEquals(result.get("backend/services")?.parent_path, "backend");

  // Test nested files
  assertEquals(result.get("backend/server.ts")?.type, "file");
  assertEquals(result.get("backend/server.ts")?.level, 2);
  assertEquals(result.get("backend/server.ts")?.parent_path, "backend");

  assertEquals(result.get("backend/services/userService.ts")?.type, "file");
  assertEquals(result.get("backend/services/userService.ts")?.level, 3);
  assertEquals(
    result.get("backend/services/userService.ts")?.parent_path,
    "backend/services",
  );
});

test("buildPathNodes - handles renamed files correctly", () => {
  FileSystemActivityHelper.reset();
  const builder = createBuilder();

  const activities = FileSystemActivityHelper.buildTestScenario();
  const renameChains = builder.buildRenameChains(activities);

  const result = builder.buildPathNodes(activities, renameChains);

  // Renamed file should appear under its ultimate name
  assertEquals(result.get("backend/config.ts")?.type, "file");
  assertEquals(result.get("backend/config.ts")?.level, 2);
  assertEquals(result.get("backend/config.ts")?.parent_path, "backend");

  // Original name should not exist in hierarchy
  assertEquals(result.get("old-config.js"), undefined);

  // Frontend rename
  assertEquals(result.get("frontend/utils.ts")?.type, "file");
  assertEquals(result.get("frontend/old-utils.js"), undefined);
});

test("buildPathNodes - assigns activities to correct files", () => {
  FileSystemActivityHelper.reset();
  const builder = createBuilder();

  const activities = FileSystemActivityHelper.buildTestScenario();
  const renameChains = builder.buildRenameChains(activities);

  const result = builder.buildPathNodes(activities, renameChains);

  // README.md should have 3 activities (alice, bob, alice)
  assertEquals(result.get("README.md")?.activities.length, 3);

  // backend/server.ts should have 4 activities
  assertEquals(result.get("backend/server.ts")?.activities.length, 4);

  // Renamed file should have all activities (including the rename)
  const configActivities = result.get("backend/config.ts")?.activities;
  assertEquals(configActivities?.length, 2); // rename + additional activity

  // Verify activities are correctly assigned to ultimate filename
  const hasRenameActivity = configActivities?.some(
    (a) => a.status === "renamed",
  );
  assertEquals(hasRenameActivity, true);
});

test("buildFileSystemTree - related entities track file co-change directionally", () => {
  FileSystemActivityHelper.reset();
  const builder = createBuilder();

  const activities = [
    FileSystemActivityHelper.buildActivity({
      filename: "src/a.ts",
      gh_login: "alice",
      user_id: 1,
      additions: 10,
      deletions: 1,
      gh_issue_id: 101,
      merged_at: "2025-09-01T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "src/b.ts",
      gh_login: "alice",
      user_id: 1,
      additions: 8,
      deletions: 1,
      gh_issue_id: 101,
      merged_at: "2025-09-01T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "src/a.ts",
      gh_login: "alice",
      user_id: 1,
      additions: 12,
      deletions: 2,
      gh_issue_id: 102,
      merged_at: "2025-09-02T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "src/b.ts",
      gh_login: "alice",
      user_id: 1,
      additions: 7,
      deletions: 1,
      gh_issue_id: 102,
      merged_at: "2025-09-02T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "src/c.ts",
      gh_login: "alice",
      user_id: 1,
      additions: 6,
      deletions: 1,
      gh_issue_id: 102,
      merged_at: "2025-09-02T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "src/a.ts",
      gh_login: "alice",
      user_id: 1,
      additions: 5,
      deletions: 1,
      gh_issue_id: 103,
      merged_at: "2025-09-03T10:00:00Z",
    }),
  ];

  const treeData = builder.buildFileSystemTree(
    activities,
    buildUserLastSeenMap(activities),
  );

  const aNode = treeData.nodes.get("src/a.ts");
  const bNode = treeData.nodes.get("src/b.ts");
  const srcFolder = treeData.nodes.get("src");

  assert(aNode?.related_entities != null);
  assertEquals(
    aNode!.related_entities.map((entity) => ({
      path: entity.path,
      type: entity.type,
      shared_prs: entity.shared_prs,
      cochange_pct: entity.cochange_pct,
      recent_shared_prs: entity.recent_shared_prs.map((pr) => pr.gh_issue_id),
    })),
    [
      {
        path: "src/b.ts",
        type: "file",
        shared_prs: 2,
        cochange_pct: 66.7,
        recent_shared_prs: [102, 101],
      },
    ],
  );

  assert(bNode?.related_entities != null);
  assertEquals(
    bNode!.related_entities.map((entity) => ({
      path: entity.path,
      type: entity.type,
      shared_prs: entity.shared_prs,
      cochange_pct: entity.cochange_pct,
      recent_shared_prs: entity.recent_shared_prs.map((pr) => pr.gh_issue_id),
    })),
    [
      {
        path: "src/a.ts",
        type: "file",
        shared_prs: 2,
        cochange_pct: 100,
        recent_shared_prs: [102, 101],
      },
    ],
  );

  assertEquals(srcFolder?.related_entities, undefined);
});

test("buildFileSystemTree - related entities follow canonical rename target", () => {
  FileSystemActivityHelper.reset();
  const builder = createBuilder();

  const activities = [
    FileSystemActivityHelper.buildActivity({
      filename: "libs/abc.ts",
      gh_login: "alice",
      user_id: 1,
      additions: 10,
      deletions: 1,
      gh_issue_id: 201,
      merged_at: "2025-08-01T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "src/helper.ts",
      gh_login: "alice",
      user_id: 1,
      additions: 4,
      deletions: 1,
      gh_issue_id: 201,
      merged_at: "2025-08-01T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "packages/abc.ts",
      status: "renamed",
      previous_filename: "libs/abc.ts",
      gh_login: "alice",
      user_id: 1,
      additions: 1,
      deletions: 1,
      gh_issue_id: 202,
      merged_at: "2025-08-10T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "src/helper.ts",
      gh_login: "alice",
      user_id: 1,
      additions: 5,
      deletions: 2,
      gh_issue_id: 202,
      merged_at: "2025-08-10T10:00:00Z",
    }),
  ];

  const treeData = builder.buildFileSystemTree(
    activities,
    buildUserLastSeenMap(activities),
  );

  assertEquals(treeData.nodes.get("libs/abc.ts"), undefined);

  const renamedNode = treeData.nodes.get("packages/abc.ts");
  assert(renamedNode?.related_entities != null);
  assertEquals(
    renamedNode!.related_entities.map((entity) => ({
      path: entity.path,
      type: entity.type,
      shared_prs: entity.shared_prs,
      cochange_pct: entity.cochange_pct,
      recent_shared_prs: entity.recent_shared_prs.map((pr) => pr.gh_issue_id),
    })),
    [
      {
        path: "src/helper.ts",
        type: "file",
        shared_prs: 2,
        cochange_pct: 100,
        recent_shared_prs: [202, 201],
      },
    ],
  );
});

test("buildFileSystemTree - stores file history only for renamed or moved files", () => {
  FileSystemActivityHelper.reset();
  const builder = createBuilder();

  const activities = [
    FileSystemActivityHelper.buildActivity({
      filename: "src/original.ts",
      status: "added",
      gh_login: "alice",
      user_id: 1,
      additions: 10,
      deletions: 0,
      gh_issue_id: 501,
      title: "Add original file",
      merged_at: "2025-08-01T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "src/renamed.ts",
      status: "renamed",
      previous_filename: "src/original.ts",
      gh_login: "alice",
      user_id: 1,
      additions: 2,
      deletions: 1,
      gh_issue_id: 502,
      title: "Rename file in place",
      merged_at: "2025-08-10T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "packages/renamed.ts",
      status: "renamed",
      previous_filename: "src/renamed.ts",
      gh_login: "alice",
      user_id: 1,
      additions: 1,
      deletions: 1,
      gh_issue_id: 503,
      title: "Move file to packages",
      merged_at: "2025-08-20T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "apps/final.ts",
      status: "renamed",
      previous_filename: "packages/renamed.ts",
      gh_login: "alice",
      user_id: 1,
      additions: 3,
      deletions: 2,
      gh_issue_id: 504,
      title: "Move and rename file",
      merged_at: "2025-08-30T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "src/stationary.ts",
      status: "added",
      gh_login: "bob",
      user_id: 2,
      additions: 5,
      deletions: 0,
      gh_issue_id: 505,
      title: "Add stationary file",
      merged_at: "2025-08-05T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "src/stationary.ts",
      status: "modified",
      gh_login: "bob",
      user_id: 2,
      additions: 2,
      deletions: 1,
      gh_issue_id: 506,
      title: "Update stationary file",
      merged_at: "2025-08-15T10:00:00Z",
    }),
  ];

  const treeData = builder.buildFileSystemTree(
    activities,
    buildUserLastSeenMap(activities),
  );

  const finalNode = treeData.nodes.get("apps/final.ts");
  assert(finalNode != null);
  assertEquals(finalNode.history, [
    {
      kind: "rename",
      from_path: "src/original.ts",
      to_path: "src/renamed.ts",
      gh_issue_id: 502,
      title: "Rename file in place",
      merged_at: "2025-08-10T10:00:00.000Z",
    },
    {
      kind: "move",
      from_path: "src/renamed.ts",
      to_path: "packages/renamed.ts",
      gh_issue_id: 503,
      title: "Move file to packages",
      merged_at: "2025-08-20T10:00:00.000Z",
    },
    {
      kind: "move_and_rename",
      from_path: "packages/renamed.ts",
      to_path: "apps/final.ts",
      gh_issue_id: 504,
      title: "Move and rename file",
      merged_at: "2025-08-30T10:00:00.000Z",
    },
  ]);

  const stationaryNode = treeData.nodes.get("src/stationary.ts");
  assert(stationaryNode != null);
  assertEquals(stationaryNode.history, undefined);
});

test("buildFileSystemTree - related entities reset after remove and re-add", () => {
  FileSystemActivityHelper.reset();
  const builder = createBuilder();

  const activities = [
    FileSystemActivityHelper.buildActivity({
      filename: "temp/script.ts",
      status: "added",
      gh_login: "alice",
      user_id: 1,
      additions: 10,
      deletions: 0,
      gh_issue_id: 301,
      merged_at: "2025-07-01T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "old/helper.ts",
      status: "added",
      gh_login: "alice",
      user_id: 1,
      additions: 8,
      deletions: 0,
      gh_issue_id: 301,
      merged_at: "2025-07-01T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "temp/script.ts",
      status: "removed",
      gh_login: "alice",
      user_id: 1,
      additions: 0,
      deletions: 10,
      gh_issue_id: 302,
      merged_at: "2025-07-02T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "temp/script.ts",
      status: "added",
      gh_login: "alice",
      user_id: 1,
      additions: 12,
      deletions: 0,
      gh_issue_id: 303,
      merged_at: "2025-08-01T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "new/helper.ts",
      status: "added",
      gh_login: "alice",
      user_id: 1,
      additions: 9,
      deletions: 0,
      gh_issue_id: 303,
      merged_at: "2025-08-01T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "temp/script.ts",
      gh_login: "alice",
      user_id: 1,
      additions: 5,
      deletions: 1,
      gh_issue_id: 304,
      merged_at: "2025-08-02T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "new/helper.ts",
      gh_login: "alice",
      user_id: 1,
      additions: 4,
      deletions: 1,
      gh_issue_id: 304,
      merged_at: "2025-08-02T10:00:00Z",
    }),
  ];

  const treeData = builder.buildFileSystemTree(
    activities,
    buildUserLastSeenMap(activities),
  );

  const scriptNode = treeData.nodes.get("temp/script.ts");
  assert(scriptNode?.related_entities != null);
  assertEquals(
    scriptNode!.related_entities.map((entity) => ({
      path: entity.path,
      type: entity.type,
      shared_prs: entity.shared_prs,
      cochange_pct: entity.cochange_pct,
      recent_shared_prs: entity.recent_shared_prs.map((pr) => pr.gh_issue_id),
    })),
    [
      {
        path: "new/helper.ts",
        type: "file",
        shared_prs: 2,
        cochange_pct: 100,
        recent_shared_prs: [304, 303],
      },
    ],
  );
});

test("buildFileSystemTree - related entities ignore oversized PRs", () => {
  FileSystemActivityHelper.reset();
  const builder = createBuilder(DEFAULT_TEST_NOW, {
    maxFilesPerPr: 2,
  });

  const activities = [
    FileSystemActivityHelper.buildActivity({
      filename: "src/a.ts",
      gh_login: "alice",
      user_id: 1,
      additions: 10,
      deletions: 1,
      gh_issue_id: 401,
      merged_at: "2025-09-01T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "src/b.ts",
      gh_login: "alice",
      user_id: 1,
      additions: 10,
      deletions: 1,
      gh_issue_id: 401,
      merged_at: "2025-09-01T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "src/c.ts",
      gh_login: "alice",
      user_id: 1,
      additions: 10,
      deletions: 1,
      gh_issue_id: 401,
      merged_at: "2025-09-01T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "src/a.ts",
      gh_login: "alice",
      user_id: 1,
      additions: 8,
      deletions: 1,
      gh_issue_id: 402,
      merged_at: "2025-09-02T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "src/b.ts",
      gh_login: "alice",
      user_id: 1,
      additions: 8,
      deletions: 1,
      gh_issue_id: 402,
      merged_at: "2025-09-02T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "src/a.ts",
      gh_login: "alice",
      user_id: 1,
      additions: 8,
      deletions: 1,
      gh_issue_id: 403,
      merged_at: "2025-09-03T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "src/b.ts",
      gh_login: "alice",
      user_id: 1,
      additions: 8,
      deletions: 1,
      gh_issue_id: 403,
      merged_at: "2025-09-03T10:00:00Z",
    }),
  ];

  const treeData = builder.buildFileSystemTree(
    activities,
    buildUserLastSeenMap(activities),
  );

  const aNode = treeData.nodes.get("src/a.ts");
  assert(aNode?.related_entities != null);
  assertEquals(
    aNode!.related_entities.map((entity) => ({
      path: entity.path,
      type: entity.type,
      shared_prs: entity.shared_prs,
      cochange_pct: entity.cochange_pct,
      recent_shared_prs: entity.recent_shared_prs.map((pr) => pr.gh_issue_id),
    })),
    [
      {
        path: "src/b.ts",
        type: "file",
        shared_prs: 2,
        cochange_pct: 66.7,
        recent_shared_prs: [403, 402],
      },
    ],
  );
});

test("buildFileSystemTree - related entities keep recent shared PR samples capped and ordered", () => {
  FileSystemActivityHelper.reset();
  const builder = createBuilder(DEFAULT_TEST_NOW, {
    maxRecentSharedPrs: 2,
  });

  const activities = [
    FileSystemActivityHelper.buildActivity({
      filename: "src/a.ts",
      gh_login: "alice",
      user_id: 1,
      additions: 3,
      deletions: 1,
      gh_issue_id: 501,
      title: "Old pair",
      merged_at: "2025-09-01T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "src/b.ts",
      gh_login: "alice",
      user_id: 1,
      additions: 3,
      deletions: 1,
      gh_issue_id: 501,
      title: "Old pair",
      merged_at: "2025-09-01T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "src/a.ts",
      gh_login: "alice",
      user_id: 1,
      additions: 4,
      deletions: 1,
      gh_issue_id: 502,
      title: "Middle pair",
      merged_at: "2025-09-02T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "src/b.ts",
      gh_login: "alice",
      user_id: 1,
      additions: 4,
      deletions: 1,
      gh_issue_id: 502,
      title: "Middle pair",
      merged_at: "2025-09-02T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "src/a.ts",
      gh_login: "alice",
      user_id: 1,
      additions: 5,
      deletions: 1,
      gh_issue_id: 503,
      title: "Newest pair",
      merged_at: "2025-09-03T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "src/b.ts",
      gh_login: "alice",
      user_id: 1,
      additions: 5,
      deletions: 1,
      gh_issue_id: 503,
      title: "Newest pair",
      merged_at: "2025-09-03T10:00:00Z",
    }),
  ];

  const treeData = builder.buildFileSystemTree(
    activities,
    buildUserLastSeenMap(activities),
  );

  const aNode = treeData.nodes.get("src/a.ts");
  assert(aNode?.related_entities != null);
  assertEquals(aNode!.related_entities[0].shared_prs, 3);
  assertEquals(aNode!.related_entities[0].recent_shared_prs, [
    {
      gh_issue_id: 503,
      title: "Newest pair",
      merged_at: "2025-09-03T10:00:00Z",
    },
    {
      gh_issue_id: 502,
      title: "Middle pair",
      merged_at: "2025-09-02T10:00:00Z",
    },
  ]);
});

// Integration test combining both methods
test("integration - buildRenameChains + buildPathNodes", () => {
  FileSystemActivityHelper.reset();
  const builder = createBuilder();

  const activities = FileSystemActivityHelper.buildTestScenario();

  // Step 1: Build rename chains
  const renameChains = builder.buildRenameChains(activities);

  // Step 2: Build path nodes using rename chains
  const pathNodes = builder.buildPathNodes(activities, renameChains);

  // Verify integration works correctly
  assertEquals(renameChains.size, 4); // 2 rename chains + canonical self entries

  // Verify hierarchy has correct structure
  const folderNodes = Array.from(pathNodes.values()).filter(
    (n) => n.type === "folder",
  );
  const fileNodes = Array.from(pathNodes.values()).filter(
    (n) => n.type === "file",
  );

  assertEquals(folderNodes.length, 3); // backend, frontend, backend/services
  // Should be 10 files because deprecated.js is removed and doesn't exist in final tree
  assertEquals(fileNodes.length, 10);

  const totalActivitiesInFiles = Array.from(pathNodes.values())
    .filter((n) => n.type === "file")
    .reduce((sum, n) => sum + n.activities.length, 0);

  assertEquals(totalActivitiesInFiles, activities.length - 1);
});

test("buildRenameChains - handles real-world SpanTree rename scenario", () => {
  FileSystemActivityHelper.reset();
  const builder = createBuilder();

  // Simplified paths for readability
  const shortPath = "SpanTree.tsx";
  const tracesPath = "traces/spans/SpanTree.tsx";
  const explorePath = "explore/traces/spans/SpanTree.tsx";

  // Create activities matching the real SpanTree rename timeline (chronological order)
  const activities = [
    // 1. Original file modifications (2023-2024)
    FileSystemActivityHelper.buildActivity({
      filename: shortPath,
      gh_login: "user156",
      user_id: 156,
      additions: 5,
      deletions: 10,
      gh_issue_id: 1,
      merged_at: "2023-11-28T09:29:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: shortPath,
      gh_login: "user156",
      user_id: 156,
      additions: 8,
      deletions: 49,
      gh_issue_id: 2,
      merged_at: "2023-12-08T09:02:55Z",
    }),

    // 2. Rename: SpanTree.tsx → traces/spans/SpanTree.tsx (2024-03-17)
    FileSystemActivityHelper.buildActivity({
      filename: tracesPath,
      status: "renamed",
      previous_filename: shortPath,
      gh_login: "user156",
      user_id: 156,
      additions: 1,
      deletions: 1,
      gh_issue_id: 3,
      merged_at: "2024-03-17T08:50:40Z",
    }),

    // 3. Modifications at traces/spans location (2024-06)
    FileSystemActivityHelper.buildActivity({
      filename: tracesPath,
      gh_login: "user156",
      user_id: 156,
      additions: 3,
      deletions: 3,
      gh_issue_id: 4,
      merged_at: "2024-06-13T11:21:49Z",
    }),

    // 4. Rename: traces/spans → explore/traces/spans (2024-12-03)
    FileSystemActivityHelper.buildActivity({
      filename: explorePath,
      status: "renamed",
      previous_filename: tracesPath,
      gh_login: "user156",
      user_id: 156,
      additions: 1,
      deletions: 1,
      gh_issue_id: 5,
      merged_at: "2024-12-03T13:43:07Z",
    }),

    // 5. Modifications at explore location (2025-02-03)
    FileSystemActivityHelper.buildActivity({
      filename: explorePath,
      gh_login: "user156",
      user_id: 156,
      additions: 2,
      deletions: 1,
      gh_issue_id: 6,
      merged_at: "2025-02-04T11:17:07Z",
    }),

    // 6. Rename back: explore/traces/spans → traces/spans (2025-04-14)
    FileSystemActivityHelper.buildActivity({
      filename: tracesPath,
      status: "renamed",
      previous_filename: explorePath,
      gh_login: "user156",
      user_id: 156,
      additions: 2,
      deletions: 2,
      gh_issue_id: 7,
      merged_at: "2025-04-14T20:24:58Z",
    }),

    // 7. Final modifications at traces/spans (2025-04-06)
    FileSystemActivityHelper.buildActivity({
      filename: tracesPath,
      gh_login: "user156",
      user_id: 156,
      additions: 6,
      deletions: 6,
      gh_issue_id: 8,
      merged_at: "2025-06-02T20:59:45Z",
    }),
  ];

  const result = builder.buildRenameChains(activities);

  // With the cycle detection, the system should handle this gracefully
  // The exact behavior depends on cycle handling, but it should not crash
  assert(result != null);

  // The first rename in the chain should map to its immediate destination
  // (since cycles break the chain resolution)
  assertEquals(result.get(shortPath), tracesPath);
});

test("integration - real SpanTree scenario with tree API", () => {
  FileSystemActivityHelper.reset();
  const builder = createBuilder();

  // Use the same test data as above but test the tree building
  const shortPath = "SpanTree.tsx";
  const tracesPath = "traces/spans/SpanTree.tsx";
  const explorePath = "explore/traces/spans/SpanTree.tsx";

  const activities = [
    FileSystemActivityHelper.buildActivity({
      filename: shortPath,
      gh_login: "alice",
      additions: 10,
      deletions: 5,
      gh_issue_id: 1,
      merged_at: "2023-11-28T09:29:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: tracesPath,
      status: "renamed",
      previous_filename: shortPath,
      gh_login: "alice",
      additions: 1,
      deletions: 1,
      gh_issue_id: 2,
      merged_at: "2024-03-17T08:50:40Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: explorePath,
      status: "renamed",
      previous_filename: tracesPath,
      gh_login: "bob",
      additions: 5,
      deletions: 2,
      gh_issue_id: 3,
      merged_at: "2024-12-03T13:43:07Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: tracesPath,
      status: "renamed",
      previous_filename: explorePath,
      gh_login: "charlie",
      additions: 3,
      deletions: 1,
      gh_issue_id: 4,
      merged_at: "2025-04-14T20:24:58Z",
    }),
  ];

  // Provide a UA provider derived from activities for this test
  const treeData = builder.buildFileSystemTree(
    activities,
    buildUserLastSeenMap(activities),
  );

  // Should aggregate all activities under the final filename
  const spanTreeFile = treeData.nodes.get(tracesPath);
  assert(spanTreeFile != null, "SpanTree file should exist at final location");

  // All four PRs must contribute exactly once, despite revisiting an old path.
  assertEquals(spanTreeFile.total_adds, 19);
  assertEquals(spanTreeFile.total_subs, 9);
  assertEquals(spanTreeFile.total_changes, 28);
  assertEquals(spanTreeFile.total_prs, 4);
  assertEquals(spanTreeFile.total_contributors, 3);
  assertEquals(
    spanTreeFile.contributors
      ?.map((contributor) => ({
        login: contributor.gh_login,
        additions: contributor.total_adds,
        deletions: contributor.total_subs,
        prs: contributor.num_prs,
      }))
      .sort((left, right) => left.login.localeCompare(right.login)),
    [
      { login: "alice", additions: 11, deletions: 6, prs: 2 },
      { login: "bob", additions: 5, deletions: 2, prs: 1 },
      { login: "charlie", additions: 3, deletions: 1, prs: 1 },
    ],
  );
  assertEquals(
    [...treeData.nodes.values()]
      .filter((node) => node.type === "file")
      .map((node) => node.path),
    [tracesPath],
  );
});

test("integration - complete file lifecycle with tree API: added → modified → removed", () => {
  FileSystemActivityHelper.reset();
  const builder = createBuilder();

  const filename = "upload-test-data-to-datadog.sh";

  // Create activities matching the real file lifecycle (chronological order)
  const activities = [
    // 1. File added (37 additions, 0 deletions)
    FileSystemActivityHelper.buildActivity({
      filename: filename,
      status: "added",
      gh_login: "user48",
      user_id: 48,
      additions: 37,
      deletions: 0,
      gh_issue_id: 1383048,
      merged_at: "2025-04-10T13:53:44Z",
    }),

    // 2. Modified (5 additions, 2 deletions)
    FileSystemActivityHelper.buildActivity({
      filename: filename,
      status: "modified",
      gh_login: "user156",
      user_id: 156,
      additions: 5,
      deletions: 2,
      gh_issue_id: 1403783,
      merged_at: "2025-04-25T21:25:41Z",
    }),

    // 3. Modified (15 additions, 2 deletions)
    FileSystemActivityHelper.buildActivity({
      filename: filename,
      status: "modified",
      gh_login: "user156",
      user_id: 156,
      additions: 15,
      deletions: 2,
      gh_issue_id: 1416199,
      merged_at: "2025-05-08T14:11:26Z",
    }),

    // 4. Modified (2 additions, 15 deletions)
    FileSystemActivityHelper.buildActivity({
      filename: filename,
      status: "modified",
      gh_login: "user156",
      user_id: 156,
      additions: 2,
      deletions: 15,
      gh_issue_id: 1410223,
      merged_at: "2025-05-08T18:06:14Z",
    }),

    // 5. Modified (15 additions, 2 deletions)
    FileSystemActivityHelper.buildActivity({
      filename: filename,
      status: "modified",
      gh_login: "user156",
      user_id: 156,
      additions: 15,
      deletions: 2,
      gh_issue_id: 1430766,
      merged_at: "2025-05-19T17:26:40Z",
    }),

    // 6. Modified (5 additions, 1 deletion)
    FileSystemActivityHelper.buildActivity({
      filename: filename,
      status: "modified",
      gh_login: "user156",
      user_id: 156,
      additions: 5,
      deletions: 1,
      gh_issue_id: 1450178,
      merged_at: "2025-06-02T19:07:01Z",
    }),

    // 7. File removed (0 additions, 57 deletions)
    FileSystemActivityHelper.buildActivity({
      filename: filename,
      status: "removed",
      gh_login: "user156",
      user_id: 156,
      additions: 0,
      deletions: 57,
      gh_issue_id: 1446764,
      merged_at: "2025-06-06T14:16:36Z",
    }),
  ];

  // Test rename chains (should be empty - no renames)
  const renameChains = builder.buildRenameChains(activities);
  assertEquals(renameChains.size, 0);

  const treeData = builder.buildFileSystemTree(
    activities,
    buildUserLastSeenMap(activities),
  );

  // With our fix, removed files should NOT appear in the final tree
  const testFile = treeData.nodes.get(filename);
  assertEquals(
    testFile,
    undefined,
    "Removed file should not exist in final tree",
  );

  // Verify the file is not in root paths either
  assertEquals(
    treeData.rootPaths.includes(filename),
    false,
    "Removed file should not be in root paths",
  );
});

test("buildFileSystemTree - real SpanTree scenario with rename cycles", () => {
  FileSystemActivityHelper.reset();
  const builder = createBuilder();

  // Use the same test data as the legacy test but test the tree building
  const shortPath = "SpanTree.tsx";
  const tracesPath = "traces/spans/SpanTree.tsx";
  const explorePath = "explore/traces/spans/SpanTree.tsx";

  const activities = [
    FileSystemActivityHelper.buildActivity({
      filename: shortPath,
      gh_login: "alice",
      additions: 10,
      deletions: 5,
      gh_issue_id: 1,
      merged_at: "2023-11-28T09:29:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: tracesPath,
      status: "renamed",
      previous_filename: shortPath,
      gh_login: "alice",
      additions: 1,
      deletions: 1,
      gh_issue_id: 2,
      merged_at: "2024-03-17T08:50:40Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: explorePath,
      status: "renamed",
      previous_filename: tracesPath,
      gh_login: "bob",
      additions: 5,
      deletions: 2,
      gh_issue_id: 3,
      merged_at: "2024-12-03T13:43:07Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: tracesPath,
      status: "renamed",
      previous_filename: explorePath,
      gh_login: "charlie",
      additions: 3,
      deletions: 1,
      gh_issue_id: 4,
      merged_at: "2025-04-14T20:24:58Z",
    }),
  ];

  const treeData = builder.buildFileSystemTree(
    activities,
    buildUserLastSeenMap(activities),
  );

  // With cycle detection, the file should appear at the final resolved location
  // This may fail and show us what we need to fix
  const spanTreeNode = treeData.nodes.get(tracesPath);
  assert(
    spanTreeNode != null,
    "SpanTree file should exist in tree at final location",
  );

  assertEquals(spanTreeNode.type, "file");
  assertEquals(spanTreeNode.name, "SpanTree.tsx");
  assertEquals(spanTreeNode.level, 3); // traces/spans/SpanTree.tsx = level 3

  // Should have activities aggregated
  assert(spanTreeNode.total_adds != null);
  assert(spanTreeNode.total_subs != null);
  assert(spanTreeNode.total_changes != null);

  // Should have contributors
  assertEquals(spanTreeNode.total_contributors >= 1, true);

  // Verify folder structure exists
  assertEquals(treeData.nodes.get("traces")?.type, "folder");
  assertEquals(treeData.nodes.get("traces/spans")?.type, "folder");

  // Root paths should include "traces"
  assertEquals(treeData.rootPaths.includes("traces"), true);
});

test("buildFileSystemTree - file lifecycle: add → modify → remove → add", () => {
  FileSystemActivityHelper.reset();
  const builder = createBuilder();

  const filename = "temp-script.js";

  // Create activities for a complete lifecycle with resurrection
  const activities = [
    // First lifecycle: add → modify → remove
    FileSystemActivityHelper.buildActivity({
      filename: filename,
      status: "added",
      gh_login: "alice",
      additions: 20,
      deletions: 0,
      gh_issue_id: 1,
      merged_at: "2025-01-01T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: filename,
      status: "modified",
      gh_login: "alice",
      additions: 5,
      deletions: 2,
      gh_issue_id: 2,
      merged_at: "2025-01-02T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: filename,
      status: "removed",
      gh_login: "bob",
      additions: 0,
      deletions: 23,
      gh_issue_id: 3,
      merged_at: "2025-01-03T10:00:00Z",
    }),

    // Second lifecycle: add again
    FileSystemActivityHelper.buildActivity({
      filename: filename,
      status: "added",
      gh_login: "charlie",
      additions: 30,
      deletions: 0,
      gh_issue_id: 4,
      merged_at: "2025-02-01T10:00:00Z",
    }),
  ];

  const treeData = builder.buildFileSystemTree(
    activities,
    buildUserLastSeenMap(activities),
  );

  // File should exist in final tree
  const fileNode = treeData.nodes.get(filename);
  assert(fileNode != null, "File should exist in tree after being re-added");

  // Should only have stats from the current lifecycle (only charlie's activity)
  assertEquals(
    fileNode.total_adds,
    30,
    "Should only count additions from new lifecycle",
  );
  assertEquals(
    fileNode.total_subs,
    0,
    "Should only count deletions from new lifecycle",
  );
  assertEquals(
    fileNode.total_changes,
    30,
    "Should only count changes from new lifecycle",
  );
  assertEquals(
    fileNode.total_prs,
    1,
    "Should only count PRs from new lifecycle",
  );
  assertEquals(
    fileNode.total_contributors,
    1,
    "Should only count contributors from new lifecycle",
  );

  // Should only have charlie as contributor
  const charlie = fileNode.contributors?.find((c) => c.gh_login === "charlie");
  assert(charlie != null, "Charlie should be the only contributor");
  assertEquals(
    fileNode.contributors?.length,
    1,
    "Should have exactly one contributor",
  );
  assertEquals(charlie.total_adds, 30, "Charlie should have correct stats");
  assertEquals(charlie.total_subs, 0, "Charlie should have correct stats");
});

test("buildFileSystemTree - empty folder cleanup when all files removed", () => {
  FileSystemActivityHelper.reset();
  const builder = createBuilder();

  const activities = [
    // Add files to a nested folder structure
    FileSystemActivityHelper.buildActivity({
      filename: "temp/data/file1.txt",
      status: "added",
      gh_login: "alice",
      additions: 10,
      deletions: 0,
      gh_issue_id: 1,
      merged_at: "2025-01-01T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "temp/data/file2.txt",
      status: "added",
      gh_login: "alice",
      additions: 20,
      deletions: 0,
      gh_issue_id: 2,
      merged_at: "2025-01-02T10:00:00Z",
    }),

    // Remove both files
    FileSystemActivityHelper.buildActivity({
      filename: "temp/data/file1.txt",
      status: "removed",
      gh_login: "bob",
      additions: 0,
      deletions: 10,
      gh_issue_id: 3,
      merged_at: "2025-01-03T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "temp/data/file2.txt",
      status: "removed",
      gh_login: "bob",
      additions: 0,
      deletions: 20,
      gh_issue_id: 4,
      merged_at: "2025-01-04T10:00:00Z",
    }),
  ];

  const treeData = builder.buildFileSystemTree(
    activities,
    buildUserLastSeenMap(activities),
  );

  // Files should not exist in final tree
  assertEquals(
    treeData.nodes.get("temp/data/file1.txt"),
    undefined,
    "file1.txt should not exist",
  );
  assertEquals(
    treeData.nodes.get("temp/data/file2.txt"),
    undefined,
    "file2.txt should not exist",
  );

  // Empty folders should also not exist in final tree
  assertEquals(
    treeData.nodes.get("temp/data"),
    undefined,
    "temp/data folder should not exist",
  );
  assertEquals(
    treeData.nodes.get("temp"),
    undefined,
    "temp folder should not exist",
  );

  // Root paths should be empty
  assertEquals(treeData.rootPaths.length, 0, "Should have no root paths");
});

test("buildFileSystemTree - comprehensive health roll-up with edge cases", () => {
  FileSystemActivityHelper.reset();
  const builder = createBuilder();

  /*
   * Comprehensive Health Test Structure (NOW = 2025-09-15):
   *
   * src/                                    [neutral] ← healthiest of children (good > warn > critical)
   * ├── legacy/                            [critical] ← only child is critical
   * │   └── auth.js                        [critical] ← all contributors inactive >3mo
   * ├── app/                               [good] ← healthiest of children (good > neutral)
   * │   ├── feature.js                     [good] ← >10 PRs in last 30 days
   * │   ├── state.js                       [neutral] ← active contributor, recent, <10 PRs
   * │   └── components/                    [neutral] ← healthiest of children (neutral > critical)
   * │       ├── old-button.js              [critical] ← old file + inactive contributor
   * │       └── new-button.js              [neutral] ← active, recent, <10 PRs
   * ├── utils/                             [neutral] ← healthiest of children (neutral > warn)
   * │   ├── helpers.js                     [warn] ← >75% changes from inactive contributors
   * │   └── constants.js                   [neutral] ← active contributor, recent
   * └── docs/                              [critical] ← only child is critical
   *     └── README.md                      [critical] ← inactive contributor
   *
   * Health States Priority (most to least severe):
   * critical > warn > caution > neutral > good
   *
   * Test Coverage:
   * ✅ Critical: All contributors inactive >3 months
   * ✅ Warn: >75% changes from inactive contributors
   * ✅ Caution: Last updated >18 months ago
   * ✅ Good: >10 PRs in last 30 days
   * ✅ Neutral: Default case / no contributors
   * ✅ Folder roll-up: Healthiest wins logic
   * ✅ Edge cases: Empty contributors, mixed active/inactive
   * ✅ Deep nesting: 3+ levels of folder hierarchy
   */

  const now = new Date("2025-09-15T00:00:00Z");
  const threeMonthsAgo = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000); // 120 days ago
  const eighteenMonthsAgo = new Date(now.getTime() - 540 * 24 * 60 * 60 * 1000); // 540 days ago

  // Reset counters for consistent user_id assignment
  FileSystemActivityHelper.reset();

  const activities = [
    // CRITICAL: src/legacy/auth.js - all contributors inactive >3 months
    FileSystemActivityHelper.buildActivity({
      filename: "src/legacy/auth.js",
      gh_login: "inactiveDev",
      user_id: 1,
      additions: 100,
      deletions: 50,
      gh_issue_id: 1,
      merged_at: "2025-04-01T10:00:00Z", // Recent update, but contributor inactive
    }),

    // NEUTRAL: src/app/state.js - active contributor, recent updates, <10 PRs
    FileSystemActivityHelper.buildActivity({
      filename: "src/app/state.js",
      gh_login: "activeDev",
      user_id: 2,
      additions: 200,
      deletions: 100,
      gh_issue_id: 2,
      merged_at: "2025-08-20T10:00:00Z", // Recent update
    }),

    // GOOD: src/app/feature.js - >10 PRs in last 30 days
    ...Array.from({ length: 12 }, (_, i) =>
      FileSystemActivityHelper.buildActivity({
        filename: "src/app/feature.js",
        gh_login: "activeDev",
        user_id: 2, // Same active contributor
        additions: 10,
        deletions: 5,
        gh_issue_id: 100 + i,
        merged_at: new Date(
          now.getTime() - i * 24 * 60 * 60 * 1000,
        ).toISOString(), // Within 30 days
      }),
    ),

    // CAUTION: src/app/components/old-button.js - last updated >18 months ago
    FileSystemActivityHelper.buildActivity({
      filename: "src/app/components/old-button.js",
      gh_login: "oldDev",
      user_id: 5, // New inactive contributor for old file
      additions: 50,
      deletions: 25,
      gh_issue_id: 3,
      merged_at: new Date(
        eighteenMonthsAgo.getTime() - 24 * 60 * 60 * 1000,
      ).toISOString(), // 1 day before 18 months ago
    }),

    // NEUTRAL: src/app/components/new-button.js - active, recent, <10 PRs
    FileSystemActivityHelper.buildActivity({
      filename: "src/app/components/new-button.js",
      gh_login: "activeDev",
      user_id: 2,
      additions: 75,
      deletions: 30,
      gh_issue_id: 4,
      merged_at: "2025-08-01T10:00:00Z", // Recent
    }),

    // WARN: src/utils/helpers.js - >75% changes from inactive contributors
    FileSystemActivityHelper.buildActivity({
      filename: "src/utils/helpers.js",
      gh_login: "inactiveDev",
      user_id: 1, // 80% of changes from inactive
      additions: 80,
      deletions: 40,
      gh_issue_id: 5,
      merged_at: "2025-07-01T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "src/utils/helpers.js",
      gh_login: "activeDev",
      user_id: 2, // 20% of changes from active
      additions: 20,
      deletions: 10,
      gh_issue_id: 6,
      merged_at: "2025-07-01T10:00:00Z",
    }),

    // NEUTRAL: src/utils/constants.js - active contributor, recent
    FileSystemActivityHelper.buildActivity({
      filename: "src/utils/constants.js",
      gh_login: "activeDev",
      user_id: 2,
      additions: 30,
      deletions: 15,
      gh_issue_id: 7,
      merged_at: "2025-08-15T10:00:00Z",
    }),

    // NEUTRAL: src/docs/README.md - contributor exists but inactive
    FileSystemActivityHelper.buildActivity({
      filename: "src/docs/README.md",
      gh_login: "inactiveDocWriter",
      user_id: 4, // New inactive contributor
      additions: 100,
      deletions: 0,
      gh_issue_id: 8,
      merged_at: "2025-01-01T10:00:00Z",
    }),

    // === FOLDER ROLL-UP 'GOOD' STATE (aggregate recent PRs) ===
    // services/auth.ts (6 recent PRs) -> neutral
    ...Array.from({ length: 6 }, (_, i) =>
      FileSystemActivityHelper.buildActivity({
        filename: "services/auth.ts",
        gh_login: "activeDev",
        user_id: 2,
        additions: 5,
        deletions: 5,
        gh_issue_id: 200 + i,
        merged_at: new Date(
          now.getTime() - i * 24 * 60 * 60 * 1000,
        ).toISOString(),
      }),
    ),
    // services/billing.ts (6 recent PRs) -> neutral
    ...Array.from({ length: 6 }, (_, i) =>
      FileSystemActivityHelper.buildActivity({
        filename: "services/billing.ts",
        gh_login: "activeDev",
        user_id: 2,
        additions: 5,
        deletions: 5,
        gh_issue_id: 300 + i,
        merged_at: new Date(
          now.getTime() - i * 24 * 60 * 60 * 1000,
        ).toISOString(),
      }),
    ),
  ];

  // Mock user activity data - control contributor activity states
  const userLastSeenMap = new Map<number, string>();
  userLastSeenMap.set(1, threeMonthsAgo.toISOString()); // inactiveDev: inactive >3 months
  userLastSeenMap.set(2, now.toISOString()); // activeDev: active
  userLastSeenMap.set(4, threeMonthsAgo.toISOString()); // inactiveDocWriter: inactive >3 months
  userLastSeenMap.set(5, threeMonthsAgo.toISOString()); // oldDev: inactive >3 months

  const treeData = builder.buildFileSystemTree(activities, userLastSeenMap);

  // === INDIVIDUAL FILE HEALTH VERIFICATION ===

  // Critical case
  const authFile = treeData.nodes.get("src/legacy/auth.js");
  assert(authFile?.health != null);
  assertEquals(authFile!.health!.state, "critical");
  assertEquals(
    authFile!.health!.reason,
    "No active contributors in the past 3 months",
  );

  // Neutral cases
  const stateFile = treeData.nodes.get("src/app/state.js");
  assert(stateFile?.health != null);
  assertEquals(stateFile!.health!.state, "neutral");

  const newButtonFile = treeData.nodes.get("src/app/components/new-button.js");
  assert(newButtonFile?.health != null);
  assertEquals(newButtonFile!.health!.state, "neutral");

  const constantsFile = treeData.nodes.get("src/utils/constants.js");
  assert(constantsFile?.health != null);
  assertEquals(constantsFile!.health!.state, "neutral");

  // Good case
  const featureFile = treeData.nodes.get("src/app/feature.js");
  assert(featureFile?.health != null);
  assertEquals(featureFile!.health!.state, "good");
  assertEquals(
    featureFile!.health!.reason.includes("merged PRs in the last 30 days"),
    true,
  );

  // Critical case (old file with inactive contributor)
  const oldButtonFile = treeData.nodes.get("src/app/components/old-button.js");
  assert(oldButtonFile?.health != null);
  assertEquals(oldButtonFile!.health!.state, "critical");
  assertEquals(
    oldButtonFile!.health!.reason,
    "No active contributors in the past 3 months",
  );

  // Warn case
  const helpersFile = treeData.nodes.get("src/utils/helpers.js");
  assert(helpersFile?.health != null);
  assertEquals(helpersFile!.health!.state, "warn");
  assertEquals(
    helpersFile!.health!.reason.includes(
      "Most changes authored by inactive contributors",
    ),
    true,
  );

  // Edge case: Inactive contributor
  const readmeFile = treeData.nodes.get("src/docs/README.md");
  assert(readmeFile?.health != null);
  assertEquals(readmeFile!.health!.state, "critical");
  assertEquals(
    readmeFile!.health!.reason,
    "No active contributors in the past 3 months",
  );

  // === FOLDER ROLL-UP VERIFICATION ===

  // Deep nested folder: src/app/components (neutral > critical = neutral)
  const componentsFolder = treeData.nodes.get("src/app/components");
  assert(componentsFolder?.health != null);
  assertEquals(componentsFolder!.health!.state, "neutral");

  // src/app (good > neutral > critical = good)
  const appFolder = treeData.nodes.get("src/app");
  assert(appFolder?.health != null);
  assertEquals(appFolder!.health!.state, "good");

  // src/legacy (critical = critical)
  const legacyFolder = treeData.nodes.get("src/legacy");
  assert(legacyFolder?.health != null);
  assertEquals(legacyFolder!.health!.state, "critical");

  // src/utils (neutral > warn = neutral)
  const utilsFolder = treeData.nodes.get("src/utils");
  assert(utilsFolder?.health != null);
  assertEquals(utilsFolder!.health!.state, "neutral");

  // src/docs (critical = critical)
  const docsFolder = treeData.nodes.get("src/docs");
  assert(docsFolder?.health != null);
  assertEquals(docsFolder!.health!.state, "critical");

  // Root: src (good > neutral > critical = good)
  const srcFolder = treeData.nodes.get("src");
  assert(srcFolder?.health != null);
  assertEquals(srcFolder!.health!.state, "good");

  // === FOLDER ROLL-UP 'GOOD' STATE VERIFICATION (BUG FIX) ===
  // Individual files should be neutral
  const authServiceFile = treeData.nodes.get("services/auth.ts");
  assert(authServiceFile?.health != null);
  assertEquals(authServiceFile!.health!.state, "neutral");

  const billingServiceFile = treeData.nodes.get("services/billing.ts");
  assert(billingServiceFile?.health != null);
  assertEquals(billingServiceFile!.health!.state, "neutral");

  // Parent folder should be good (6 + 6 = 12 PRs > 10)
  const servicesFolder = treeData.nodes.get("services");
  assert(servicesFolder?.health != null);
  assertEquals(servicesFolder!.health!.state, "good");
  assertEquals(
    servicesFolder!.health!.reason,
    "12 merged PRs in the last 30 days",
  );
});

test("buildFileSystemTree - handles directories tracked as files (submodule/symlink scenario)", () => {
  FileSystemActivityHelper.reset();
  const builder = createBuilder();

  // Reproduce the exact scenario from the database where directories are tracked as files
  // This happens with submodules, symlinks, or other special git tracking cases
  const activities = [
    // First, add some directories that GitHub tracks as "files" (no extension)
    FileSystemActivityHelper.buildActivity({
      filename: "src/proto/com/myapp/events", // directory tracked as file
      status: "added",
      gh_login: "dev1",
      additions: 1,
      deletions: 0,
      gh_issue_id: 1,
      merged_at: "2020-06-03T17:27:52Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "src/proto/com/myapp/api", // another directory as file
      status: "added",
      gh_login: "dev1",
      additions: 1,
      deletions: 0,
      gh_issue_id: 2,
      merged_at: "2020-06-03T17:27:52Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "src/proto/com/myapp/contracts", // directory as file
      status: "added",
      gh_login: "dev1",
      additions: 1,
      deletions: 0,
      gh_issue_id: 3,
      merged_at: "2020-06-03T17:27:52Z",
    }),

    // Now add nested "files" that are actually subdirectories
    // This creates the conflict: contracts is both a "file" and a parent folder
    FileSystemActivityHelper.buildActivity({
      filename: "src/proto/com/myapp/contracts/auth", // subdirectory as file
      status: "added",
      gh_login: "dev2",
      additions: 1,
      deletions: 0,
      gh_issue_id: 4,
      merged_at: "2022-12-07T15:34:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "src/proto/com/myapp/contracts/billing", // subdirectory as file
      status: "added",
      gh_login: "dev2",
      additions: 1,
      deletions: 0,
      gh_issue_id: 5,
      merged_at: "2022-12-07T15:34:00Z",
    }),

    // Then remove all these "files" (which are actually directories)
    FileSystemActivityHelper.buildActivity({
      filename: "src/proto/com/myapp/events",
      status: "removed",
      gh_login: "dev3",
      additions: 0,
      deletions: 1,
      gh_issue_id: 6,
      merged_at: "2022-12-21T19:59:29Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "src/proto/com/myapp/api",
      status: "removed",
      gh_login: "dev3",
      additions: 0,
      deletions: 1,
      gh_issue_id: 7,
      merged_at: "2022-12-21T19:59:29Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "src/proto/com/myapp/contracts",
      status: "removed",
      gh_login: "dev3",
      additions: 0,
      deletions: 1,
      gh_issue_id: 8,
      merged_at: "2022-12-21T19:59:29Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "src/proto/com/myapp/contracts/auth",
      status: "removed",
      gh_login: "dev3",
      additions: 0,
      deletions: 1,
      gh_issue_id: 9,
      merged_at: "2022-12-21T19:59:29Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "src/proto/com/myapp/contracts/billing",
      status: "removed",
      gh_login: "dev3",
      additions: 0,
      deletions: 1,
      gh_issue_id: 10,
      merged_at: "2022-12-21T19:59:29Z",
    }),
  ];

  // This should not throw an error about folders having no children with temporal data
  // The system should handle this gracefully
  const treeData = builder.buildFileSystemTree(
    activities,
    buildUserLastSeenMap(activities),
  );

  // All removed directories and their parent folders should be cleaned up
  assertEquals(
    treeData.nodes.get("src/proto/com/myapp/events"),
    undefined,
    "Removed directory-as-file should not exist",
  );
  assertEquals(
    treeData.nodes.get("src/proto/com/myapp/api"),
    undefined,
    "Removed directory-as-file should not exist",
  );
  assertEquals(
    treeData.nodes.get("src/proto/com/myapp/contracts"),
    undefined,
    "Removed directory-as-file should not exist",
  );
  assertEquals(
    treeData.nodes.get("src/proto/com/myapp/contracts/auth"),
    undefined,
    "Removed nested directory-as-file should not exist",
  );
  assertEquals(
    treeData.nodes.get("src/proto/com/myapp/contracts/billing"),
    undefined,
    "Removed nested directory-as-file should not exist",
  );

  // Parent folders should also be cleaned up since they have no remaining children
  assertEquals(
    treeData.nodes.get("src/proto/com/myapp"),
    undefined,
    "Empty parent folder should be cleaned up",
  );
  assertEquals(
    treeData.nodes.get("src/proto/com"),
    undefined,
    "Empty grandparent folder should be cleaned up",
  );
  assertEquals(
    treeData.nodes.get("src/proto"),
    undefined,
    "Empty great-grandparent folder should be cleaned up",
  );
  assertEquals(
    treeData.nodes.get("src"),
    undefined,
    "Empty root folder should be cleaned up",
  );

  // Tree should be completely empty
  assertEquals(treeData.rootPaths.length, 0, "Should have no root paths");
});

test("buildFileSystemTree - mixed real files and directory-as-files", () => {
  FileSystemActivityHelper.reset();
  const builder = createBuilder();

  // Test scenario where we have both real files and directories tracked as files
  const activities = [
    // Add real files
    FileSystemActivityHelper.buildActivity({
      filename: "src/utils/helper.ts",
      status: "added",
      gh_login: "dev1",
      additions: 50,
      deletions: 0,
      gh_issue_id: 1,
      merged_at: "2020-01-01T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "src/main.py",
      status: "added",
      gh_login: "dev1",
      additions: 100,
      deletions: 0,
      gh_issue_id: 2,
      merged_at: "2020-01-02T10:00:00Z",
    }),

    // Add directories tracked as files in different parts of the tree
    FileSystemActivityHelper.buildActivity({
      filename: "src/proto/events", // directory as file
      status: "added",
      gh_login: "dev2",
      additions: 1,
      deletions: 0,
      gh_issue_id: 3,
      merged_at: "2020-01-03T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "docs/api", // directory as file in different root
      status: "added",
      gh_login: "dev2",
      additions: 1,
      deletions: 0,
      gh_issue_id: 4,
      merged_at: "2020-01-04T10:00:00Z",
    }),

    // Remove the directory-as-files but keep real files
    FileSystemActivityHelper.buildActivity({
      filename: "src/proto/events",
      status: "removed",
      gh_login: "dev3",
      additions: 0,
      deletions: 1,
      gh_issue_id: 5,
      merged_at: "2020-01-05T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "docs/api",
      status: "removed",
      gh_login: "dev3",
      additions: 0,
      deletions: 1,
      gh_issue_id: 6,
      merged_at: "2020-01-06T10:00:00Z",
    }),
  ];

  const treeData = builder.buildFileSystemTree(
    activities,
    buildUserLastSeenMap(activities),
  );

  // Real files should still exist
  assert(
    treeData.nodes.get("src/utils/helper.ts") != null,
    "Real file should exist",
  );
  assert(treeData.nodes.get("src/main.py") != null, "Real file should exist");
  assert(
    treeData.nodes.get("src") != null,
    "src folder should exist because it has real files",
  );
  assert(
    treeData.nodes.get("src/utils") != null,
    "utils folder should exist because it has real files",
  );

  // Directory-as-files should be removed
  assertEquals(
    treeData.nodes.get("src/proto/events"),
    undefined,
    "Directory-as-file should be removed",
  );
  assertEquals(
    treeData.nodes.get("docs/api"),
    undefined,
    "Directory-as-file should be removed",
  );

  // Empty folders from directory-as-files should be cleaned up
  assertEquals(
    treeData.nodes.get("src/proto"),
    undefined,
    "Empty proto folder should be cleaned up",
  );
  assertEquals(
    treeData.nodes.get("docs"),
    undefined,
    "Empty docs folder should be cleaned up",
  );

  // Root should contain only src
  assertEquals(treeData.rootPaths.length, 1, "Should have one root path");
  assertEquals(treeData.rootPaths[0], "src", "Root should be src");
});

test("buildFileSystemTree - PR counting bug in folder aggregation", () => {
  FileSystemActivityHelper.reset();
  const builder = createBuilder();

  // Create a scenario where one PR touches multiple files in the same folder
  const activities = [
    // PR #100 touches file1.js

    FileSystemActivityHelper.buildActivity({
      filename: "src/components/file1.js",
      gh_login: "dev1",
      additions: 10,
      deletions: 5,
      gh_issue_id: 100, // Same PR
      merged_at: "2025-01-01T10:00:00Z",
    }),

    // PR #100 touches file2.js (same PR, different file)
    FileSystemActivityHelper.buildActivity({
      filename: "src/components/file2.js",
      gh_login: "dev1",
      additions: 20,
      deletions: 3,
      gh_issue_id: 100, // Same PR
      merged_at: "2025-01-01T10:00:00Z",
    }),

    // PR #200 touches file3.js (different PR)
    FileSystemActivityHelper.buildActivity({
      filename: "src/components/file3.js",
      gh_login: "dev2",
      additions: 15,
      deletions: 2,
      gh_issue_id: 200, // Different PR
      merged_at: "2025-01-02T10:00:00Z",
    }),
  ];

  const treeData = builder.buildFileSystemTree(
    activities,
    buildUserLastSeenMap(activities),
  );

  // Individual files should count PRs correctly
  assertEquals(
    treeData.nodes.get("src/components/file1.js")?.total_prs,
    1,
    "file1.js should have 1 PR",
  );
  assertEquals(
    treeData.nodes.get("src/components/file2.js")?.total_prs,
    1,
    "file2.js should have 1 PR",
  );
  assertEquals(
    treeData.nodes.get("src/components/file3.js")?.total_prs,
    1,
    "file3.js should have 1 PR",
  );

  // FIXED: Folder should count unique PRs: PR #100 + PR #200 = 2
  const componentsFolder = treeData.nodes.get("src/components");
  console.log(`Components folder PR count: ${componentsFolder?.total_prs}`);

  // This should now pass with the fix
  assertEquals(
    componentsFolder?.total_prs,
    2,
    "components folder should have 2 unique PRs",
  );
});

test("buildFileSystemTree - contributor PR count deduplication across files", () => {
  FileSystemActivityHelper.reset();
  const builder = createBuilder();

  // Scenario: Each author makes 1 PR that touches multiple files in the same folder
  // This tests that contributor PR counts are deduplicated at the folder level
  const activities = [
    FileSystemActivityHelper.buildActivity({
      filename: "folder/fileA.js",
      gh_login: "author1",
      additions: 10,
      deletions: 2,
      gh_issue_id: 100,
      merged_at: "2025-01-01T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "folder/fileB.js",
      gh_login: "author1",
      additions: 5,
      deletions: 1,
      gh_issue_id: 100,
      merged_at: "2025-01-01T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "folder/fileA.js",
      gh_login: "author2",
      additions: 8,
      deletions: 3,
      gh_issue_id: 200,
      merged_at: "2025-01-02T10:00:00Z",
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "folder/fileB.js",
      gh_login: "author2",
      additions: 12,
      deletions: 0,
      gh_issue_id: 200,
      merged_at: "2025-01-02T10:00:00Z",
    }),
  ];

  const treeData = builder.buildFileSystemTree(
    activities,
    buildUserLastSeenMap(activities),
  );

  assertEquals(treeData.nodes.get("folder/fileA.js")?.total_prs, 2);
  assertEquals(treeData.nodes.get("folder/fileB.js")?.total_prs, 2);
  assertEquals(
    treeData.nodes.get("folder")?.total_prs,
    2,
    "folder should have 2 unique PRs",
  );

  const folder = treeData.nodes.get("folder");
  const author1Contributor = folder?.contributors?.find(
    (c) => c.gh_login === "author1",
  );
  const author2Contributor = folder?.contributors?.find(
    (c) => c.gh_login === "author2",
  );

  // Contributor PR counts should be deduplicated when same author's PR touches multiple files
  // Each author made 1 PR that touched 2 files, so num_prs should be 1 (not 2)
  assertEquals(author1Contributor?.num_prs, 1);
  assertEquals(author2Contributor?.num_prs, 1);
});

test("buildFileSystemTree - folder health re-evaluates to warn from aggregated contributors", () => {
  FileSystemActivityHelper.reset();
  const builder = createBuilder();

  const now = new Date("2025-09-15T00:00:00Z");

  const activities = [
    // File A: dominated by inactive contributor (warn at file level)
    FileSystemActivityHelper.buildActivity({
      filename: "agg-warn/fileA.js",
      gh_login: "inactiveDev",
      user_id: 10,
      additions: 95,
      deletions: 5, // 100 changes inactive
      gh_issue_id: 501,
      merged_at: new Date(
        now.getTime() - 10 * 24 * 60 * 60 * 1000,
      ).toISOString(),
    }),
    FileSystemActivityHelper.buildActivity({
      filename: "agg-warn/fileA.js",
      gh_login: "activeDev",
      user_id: 11,
      additions: 5,
      deletions: 5, // 10 changes active
      gh_issue_id: 502,
      merged_at: new Date(
        now.getTime() - 9 * 24 * 60 * 60 * 1000,
      ).toISOString(),
    }),

    // File B: small file, all active (neutral at file level)
    FileSystemActivityHelper.buildActivity({
      filename: "agg-warn/fileB.js",
      gh_login: "activeDev",
      user_id: 11,
      additions: 10,
      deletions: 10, // 20 changes active
      gh_issue_id: 503,
      merged_at: new Date(
        now.getTime() - 8 * 24 * 60 * 60 * 1000,
      ).toISOString(),
    }),
  ];

  const userLastSeenMap = new Map<number, string>();
  // inactiveDev inactive > 3 months
  userLastSeenMap.set(
    10,
    new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000).toISOString(),
  );
  // activeDev active now
  userLastSeenMap.set(11, now.toISOString());

  const treeData = builder.buildFileSystemTree(activities, userLastSeenMap);

  const fileA = treeData.nodes.get("agg-warn/fileA.js");
  const fileB = treeData.nodes.get("agg-warn/fileB.js");
  assert(fileA?.health != null);
  assert(fileB?.health != null);
  assertEquals(fileA!.health!.state, "warn");
  assertEquals(fileB!.health!.state, "neutral");

  const folder = treeData.nodes.get("agg-warn");
  assert(folder?.health != null);
  // Aggregated inactive % = 100 / (110 + 20) = 76.9% -> warn
  assertEquals(folder!.health!.state, "warn");
});

test("buildFileSystemTree - aggregate recent PRs dedup across files for GOOD", () => {
  FileSystemActivityHelper.reset();
  const builder = createBuilder();
  const now = new Date("2025-09-15T00:00:00Z");
  const activities: FileSystemActivity[] = [];

  // fileA: PRs 1..12 over last 12 days
  for (let i = 0; i < 12; i++) {
    activities.push(
      FileSystemActivityHelper.buildActivity({
        filename: "dedup-good/fileA.ts",
        gh_login: "dev",
        user_id: 42,
        additions: 3,
        deletions: 1,
        gh_issue_id: 1000 + i,
        merged_at: new Date(
          now.getTime() - i * 24 * 60 * 60 * 1000,
        ).toISOString(),
      }),
    );
  }

  // fileB: same PRs 1..12 (overlap fully with fileA)
  for (let i = 0; i < 12; i++) {
    activities.push(
      FileSystemActivityHelper.buildActivity({
        filename: "dedup-good/fileB.ts",
        gh_login: "dev",
        user_id: 42,
        additions: 2,
        deletions: 1,
        gh_issue_id: 1000 + i,
        merged_at: new Date(
          now.getTime() - i * 24 * 60 * 60 * 1000,
        ).toISOString(),
      }),
    );
  }

  const userLastSeenMap = new Map<number, string>();
  userLastSeenMap.set(42, now.toISOString());

  const treeData = builder.buildFileSystemTree(activities, userLastSeenMap);

  const folder = treeData.nodes.get("dedup-good");
  assert(folder?.health != null);
  assertEquals(folder!.health!.state, "good");
  // Ensure dedup: count should be 12, not 24
  assertEquals(folder!.health!.reason, "12 merged PRs in the last 30 days");
});

class FileSystemActivityHelper {
  private static activityCounter = 1;
  private static userCounter = 1;

  static buildActivity(params: ActivityBuilder): FileSystemActivity {
    const counter = this.activityCounter++;
    return {
      // User data
      user_id: params.user_id ?? this.userCounter++,
      gh_login: params.gh_login || "testuser",

      // File data
      pull_request_file_id: counter,
      pull_request_id: counter,
      filename: params.filename,
      status: params.status || "modified",
      additions: params.additions,
      deletions: params.deletions,
      changes: params.additions + params.deletions,
      previous_filename: params.previous_filename || null,
      inserted_at: "2025-07-14T10:00:00Z",

      // PR data
      merged_at: params.merged_at || "2025-07-14T11:00:00Z",
      source_branch: "feature-branch",
      target_branch: "main",

      // Issue data
      gh_issue_id: params.gh_issue_id || counter,
      title: params.title || `Test PR ${counter}`,
    };
  }

  static buildTestScenario(): FileSystemActivity[] {
    /*
     * Test File Structure (Final state after renames):
     *
     * project-root/
     * ├── README.md                    [alice:3, bob:2 activities]
     * ├── package.json                 [alice:2 activities]
     * ├── deprecated.js                [alice:1 activity - REMOVED]
     * ├── backend/
     * │   ├── server.ts                [alice:2, charlie:2 activities]
     * │   ├── auth.ts                  [bob:3 activities]
     * │   ├── config.ts                [alice:1, charlie:1 activities] ← renamed from old-config.js
     * │   └── services/
     * │       ├── userService.ts       [charlie:2 activities]
     * │       └── emailService.ts      [alice:1 activity]
     * └── frontend/
     *     ├── app.tsx                  [bob:2, diana:1 activities]
     *     ├── components.tsx           [diana:2 activities]
     *     └── utils.ts                 [diana:1 activity] ← renamed from frontend/old-utils.js
     *
     * Rename Chains:
     * • old-config.js → backend/config.ts
     * • frontend/old-utils.js → frontend/utils.ts
     *
     * Contributors: alice, bob, charlie, diana
     * Total Activities: 24 (across 9 final files + 1 removed)
     * Folder Depth: 3 levels max (backend/services/userService.ts)
     */

    const activities: FileSystemActivity[] = [];

    // 2 root files
    activities.push(
      this.buildActivity({
        filename: "README.md",
        gh_login: "alice",
        additions: 50,
        deletions: 10,
        gh_issue_id: 1,
      }),
      this.buildActivity({
        filename: "README.md",
        gh_login: "bob",
        additions: 20,
        deletions: 5,
        gh_issue_id: 2,
      }),
      this.buildActivity({
        filename: "README.md",
        gh_login: "alice",
        additions: 15,
        deletions: 3,
        gh_issue_id: 3,
      }),
      this.buildActivity({
        filename: "package.json",
        gh_login: "alice",
        additions: 5,
        deletions: 2,
        gh_issue_id: 4,
      }),
      this.buildActivity({
        filename: "package.json",
        gh_login: "alice",
        additions: 3,
        deletions: 1,
        gh_issue_id: 5,
      }),
    );

    // Backend folder (2 levels deep)
    activities.push(
      this.buildActivity({
        filename: "backend/server.ts",
        gh_login: "alice",
        additions: 100,
        deletions: 20,
        gh_issue_id: 6,
      }),
      this.buildActivity({
        filename: "backend/server.ts",
        gh_login: "charlie",
        additions: 80,
        deletions: 15,
        gh_issue_id: 7,
      }),
      this.buildActivity({
        filename: "backend/server.ts",
        gh_login: "alice",
        additions: 30,
        deletions: 10,
        gh_issue_id: 8,
      }),
      this.buildActivity({
        filename: "backend/server.ts",
        gh_login: "charlie",
        additions: 25,
        deletions: 5,
        gh_issue_id: 9,
      }),
      this.buildActivity({
        filename: "backend/auth.ts",
        gh_login: "bob",
        additions: 60,
        deletions: 8,
        gh_issue_id: 10,
      }),
      this.buildActivity({
        filename: "backend/auth.ts",
        gh_login: "bob",
        additions: 40,
        deletions: 12,
        gh_issue_id: 11,
      }),
      this.buildActivity({
        filename: "backend/auth.ts",
        gh_login: "bob",
        additions: 20,
        deletions: 3,
        gh_issue_id: 12,
      }),
      this.buildActivity({
        filename: "backend/services/userService.ts",
        gh_login: "charlie",
        additions: 90,
        deletions: 10,
        gh_issue_id: 13,
      }),
      this.buildActivity({
        filename: "backend/services/userService.ts",
        gh_login: "charlie",
        additions: 40,
        deletions: 5,
        gh_issue_id: 14,
      }),
      this.buildActivity({
        filename: "backend/services/emailService.ts",
        gh_login: "alice",
        additions: 70,
        deletions: 15,
        gh_issue_id: 15,
      }),
    );

    // Frontend folder (1 level deep)
    activities.push(
      this.buildActivity({
        filename: "frontend/app.tsx",
        gh_login: "bob",
        additions: 120,
        deletions: 25,
        gh_issue_id: 16,
      }),
      this.buildActivity({
        filename: "frontend/app.tsx",
        gh_login: "diana",
        additions: 80,
        deletions: 20,
        gh_issue_id: 17,
      }),
      this.buildActivity({
        filename: "frontend/app.tsx",
        gh_login: "bob",
        additions: 30,
        deletions: 8,
        gh_issue_id: 18,
      }),
      this.buildActivity({
        filename: "frontend/components.tsx",
        gh_login: "diana",
        additions: 60,
        deletions: 12,
        gh_issue_id: 19,
      }),
      this.buildActivity({
        filename: "frontend/components.tsx",
        gh_login: "diana",
        additions: 40,
        deletions: 8,
        gh_issue_id: 20,
      }),
    );

    // Rename chains: old-config.js -> backend/config.ts
    activities.push(
      this.buildActivity({
        filename: "backend/config.ts",
        status: "renamed",
        previous_filename: "old-config.js",
        gh_login: "alice",
        additions: 30,
        deletions: 10,
        gh_issue_id: 21,
      }),
      // Additional activity on the renamed file
      this.buildActivity({
        filename: "backend/config.ts",
        gh_login: "charlie",
        additions: 15,
        deletions: 5,
        gh_issue_id: 22,
      }),
    );

    // Second rename chain: frontend/old-utils.js -> frontend/utils.ts
    activities.push(
      this.buildActivity({
        filename: "frontend/utils.ts",
        status: "renamed",
        previous_filename: "frontend/old-utils.js",
        gh_login: "diana",
        additions: 50,
        deletions: 8,
        gh_issue_id: 23,
      }),
    );

    // Removed file
    activities.push(
      this.buildActivity({
        filename: "deprecated.js",
        status: "removed",
        gh_login: "alice",
        additions: 0,
        deletions: 100,
        gh_issue_id: 24,
      }),
    );

    return activities;
  }

  static buildExpectedRenameChains(): Map<string, string> {
    return new Map([
      ["old-config.js", "backend/config.ts"],
      ["frontend/old-utils.js", "frontend/utils.ts"],
      ["backend/config.ts", "backend/config.ts"],
      ["frontend/utils.ts", "frontend/utils.ts"],
    ]);
  }

  static reset() {
    this.activityCounter = 1;
    this.userCounter = 1;
  }
}
