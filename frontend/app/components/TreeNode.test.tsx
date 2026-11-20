import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TreeNode } from "./TreeNode";
import type { FileSystemNode } from "../../../shared/models/fileSystemTree";

vi.mock("./ui/button", () => ({
  Button: ({ children, ...props }: ComponentPropsWithoutRef<"button">) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

afterEach(() => {
  cleanup();
});

function createNode(overrides: Partial<FileSystemNode>): FileSystemNode {
  return {
    name: "featureFolder",
    path: "folderA/subFolderA/subFolderB/featureFolder",
    level: 5,
    type: "folder",
    parent_path: "folderA/subFolderA/subFolderB",
    total_files: 4,
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

describe("TreeNode", () => {
  it("renders a compact folder display name", () => {
    render(
      <TreeNode
        node={createNode({})}
        displayName="folderA/subFolderA/subFolderB/featureFolder"
        isExpanded
        hasChildren
        depth={0}
        onToggle={vi.fn()}
        togglePath="folderA/subFolderA/subFolderB/featureFolder"
        collapsePath="folderA"
        isSelected={false}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("folderA/subFolderA/subFolderB/featureFolder")).toBeTruthy();
    expect(screen.queryByText("featureFolder")).toBeNull();
  });

  it("uses the compact root when collapsing a compacted folder row", () => {
    const onToggle = vi.fn();

    render(
      <TreeNode
        node={createNode({})}
        displayName="folderA/subFolderA/subFolderB/featureFolder"
        isExpanded
        hasChildren
        depth={0}
        onToggle={onToggle}
        togglePath="folderA/subFolderA/subFolderB/featureFolder"
        collapsePath="folderA"
        isSelected={false}
        onSelect={vi.fn()}
      />,
    );

    const row = screen
      .getByText("folderA/subFolderA/subFolderB/featureFolder")
      .closest('[role="button"]');
    if (!row) {
      throw new Error("Expected tree row");
    }

    fireEvent.click(within(row as HTMLElement).getByRole("button"));

    expect(onToggle).toHaveBeenCalledWith(
      "folderA/subFolderA/subFolderB/featureFolder",
      false,
      "folderA",
    );
  });

  it("shows a loading state while deferred expansion is in progress", () => {
    render(
      <TreeNode
        node={createNode({})}
        displayName="folderA/subFolderA/subFolderB/featureFolder"
        isExpanded={false}
        hasChildren
        depth={0}
        onToggle={vi.fn()}
        togglePath="folderA/subFolderA/subFolderB/featureFolder"
        collapsePath="folderA"
        isLoading
        isSelected={false}
        onSelect={vi.fn()}
      />,
    );

    const row = screen
      .getByText("folderA/subFolderA/subFolderB/featureFolder")
      .closest('[role="button"]');
    if (!row) {
      throw new Error("Expected tree row");
    }

    expect((within(row as HTMLElement).getByRole("button") as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
