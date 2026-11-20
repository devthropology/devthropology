import { test } from "vitest";
import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { FileSystemService } from "./fileSystemService.ts";
import { IRepository } from "../repository/repository.ts";
import { ComputedFileSystemNode } from "../models/dbTypes.ts";

test("getFileSystemTree preserves related entities on file nodes", async () => {
  const computedNodes: ComputedFileSystemNode[] = [
    {
      repository_id: 1,
      path: "src",
      parent_path: null,
      level: 1,
      node_data: {
        name: "src",
        path: "src",
        level: 1,
        type: "folder",
        parent_path: null,
        total_files: 1,
        total_adds: 20,
        total_subs: 5,
        total_changes: 25,
        total_prs: 2,
        total_contributors: 1,
        first_seen: "2025-01-01T00:00:00.000Z",
        last_updated: "2025-01-02T00:00:00.000Z",
        children_count: 1,
      },
    },
    {
      repository_id: 1,
      path: "src/a.ts",
      parent_path: "src",
      level: 2,
      node_data: {
        name: "a.ts",
        path: "src/a.ts",
        level: 2,
        type: "file",
        parent_path: "src",
        total_files: 1,
        total_adds: 20,
        total_subs: 5,
        total_changes: 25,
        total_prs: 2,
        total_contributors: 1,
        first_seen: "2025-01-01T00:00:00.000Z",
        last_updated: "2025-01-02T00:00:00.000Z",
        related_entities: [
          {
            path: "src/b.ts",
            type: "file",
            shared_prs: 2,
            cochange_pct: 100,
            recent_shared_prs: [
              {
                gh_issue_id: 201,
                title: "Shared PR",
                merged_at: "2025-01-02T00:00:00.000Z",
              },
            ],
          },
        ],
      },
    },
  ];

  const repository = {
    getFileSystemNodes() {
      return computedNodes;
    },
  } as unknown as IRepository;

  const service = new FileSystemService(repository, {
    log: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  });

  const result = await service.getFileSystemTree(1, "src", [2]);

  assertEquals(result.nodes.length, 2);
  assertEquals(result.nodes[1].path, "src/a.ts");
  assertEquals(result.nodes[1].related_entities, [
    {
      path: "src/b.ts",
      type: "file",
      shared_prs: 2,
      cochange_pct: 100,
      recent_shared_prs: [
        {
          gh_issue_id: 201,
          title: "Shared PR",
          merged_at: "2025-01-02T00:00:00.000Z",
        },
      ],
    },
  ]);
});
