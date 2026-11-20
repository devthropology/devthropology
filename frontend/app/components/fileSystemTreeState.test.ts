import { describe, expect, it, vi } from "vitest";
import {
  collapseExpandedFolderPaths,
  collectAutoExpandFolderPaths,
  getAncestorPaths,
  getCompactFolderChain,
} from "./fileSystemTreeState";
import type { FileSystemNode } from "../../../shared/models/fileSystemTree";

function createNode(overrides: Partial<FileSystemNode>): FileSystemNode {
  return {
    name: "node",
    path: "node",
    level: 1,
    type: "folder",
    parent_path: null,
    total_files: 1,
    total_adds: 0,
    total_subs: 0,
    total_changes: 0,
    total_prs: 0,
    total_contributors: 0,
    first_seen: "2024-01-01T00:00:00.000Z",
    last_updated: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("fileSystemTreeState", () => {
  it("returns ancestor paths for a nested path", () => {
    expect(getAncestorPaths("folderA/subFolderA/subFolderB/util.ts")).toEqual([
      "folderA",
      "folderA/subFolderA",
      "folderA/subFolderA/subFolderB",
    ]);
  });

  it("compacts an expanded single-folder chain into one row", () => {
    const folderA = createNode({ name: "folderA", path: "folderA" });
    const subFolderA = createNode({
      name: "subFolderA",
      path: "folderA/subFolderA",
      parent_path: "folderA",
      level: 2,
    });
    const subFolderB = createNode({
      name: "subFolderB",
      path: "folderA/subFolderA/subFolderB",
      parent_path: "folderA/subFolderA",
      level: 3,
    });
    const featureFolder = createNode({
      name: "featureFolder",
      path: "folderA/subFolderA/subFolderB/featureFolder",
      parent_path: "folderA/subFolderA/subFolderB",
      level: 4,
    });
    const childFolderA = createNode({
      name: "childFolderA",
      path: "folderA/subFolderA/subFolderB/featureFolder/childFolderA",
      parent_path: "folderA/subFolderA/subFolderB/featureFolder",
      level: 5,
    });
    const childFolderB = createNode({
      name: "childFolderB",
      path: "folderA/subFolderA/subFolderB/featureFolder/childFolderB",
      parent_path: "folderA/subFolderA/subFolderB/featureFolder",
      level: 5,
    });

    const compactChain = getCompactFolderChain({
      startNode: folderA,
      allNodes: [folderA, subFolderA, subFolderB, featureFolder, childFolderA, childFolderB],
      levelsLoaded: new Set([
        "folderA",
        "folderA/subFolderA",
        "folderA/subFolderA/subFolderB",
        "folderA/subFolderA/subFolderB/featureFolder",
      ]),
      expandedFolders: new Set([
        "folderA",
        "folderA/subFolderA",
        "folderA/subFolderA/subFolderB",
        "folderA/subFolderA/subFolderB/featureFolder",
      ]),
    });

    expect(compactChain.map((node) => node.path)).toEqual([
      "folderA",
      "folderA/subFolderA",
      "folderA/subFolderA/subFolderB",
      "folderA/subFolderA/subFolderB/featureFolder",
    ]);
  });

  it("stops compacting when the only child is a file", () => {
    const folderA = createNode({ name: "folderA", path: "folderA" });
    const utilFile = createNode({
      name: "util.ts",
      path: "folderA/util.ts",
      parent_path: "folderA",
      level: 2,
      type: "file",
    });

    const compactChain = getCompactFolderChain({
      startNode: folderA,
      allNodes: [folderA, utilFile],
      levelsLoaded: new Set(["folderA"]),
      expandedFolders: new Set(["folderA"]),
    });

    expect(compactChain.map((node) => node.path)).toEqual(["folderA"]);
  });

  it("collects auto-expand paths until the first branch", async () => {
    const folderA = createNode({ name: "folderA", path: "folderA" });
    const subFolderA = createNode({
      name: "subFolderA",
      path: "folderA/subFolderA",
      parent_path: "folderA",
      level: 2,
    });
    const subFolderB = createNode({
      name: "subFolderB",
      path: "folderA/subFolderA/subFolderB",
      parent_path: "folderA/subFolderA",
      level: 3,
    });
    const utilFile = createNode({
      name: "util.ts",
      path: "folderA/subFolderA/subFolderB/util.ts",
      parent_path: "folderA/subFolderA/subFolderB",
      level: 4,
      type: "file",
    });
    const helperFolder = createNode({
      name: "helperFolder",
      path: "folderA/subFolderA/subFolderB/helperFolder",
      parent_path: "folderA/subFolderA/subFolderB",
      level: 4,
    });

    const loadChildren = vi.fn(async (node: FileSystemNode) => {
      switch (node.path) {
        case "folderA":
          return [subFolderA];
        case "folderA/subFolderA":
          return [subFolderB];
        case "folderA/subFolderA/subFolderB":
          return [utilFile, helperFolder];
        default:
          return [];
      }
    });

    await expect(collectAutoExpandFolderPaths(folderA, loadChildren)).resolves.toEqual([
      "folderA",
      "folderA/subFolderA",
      "folderA/subFolderA/subFolderB",
    ]);
    expect(loadChildren).toHaveBeenCalledTimes(3);
  });

  it("collapses all descendants of a compact root", () => {
    const collapsed = collapseExpandedFolderPaths(
      new Set([
        "folderA",
        "folderA/subFolderA",
        "folderA/subFolderA/subFolderB",
        "folderA/subFolderA/subFolderB/featureFolder",
        "folderB",
      ]),
      "folderA",
    );

    expect(Array.from(collapsed)).toEqual(["folderB"]);
  });
});
