import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileSystemDetail } from "./FileSystemDetail";
import type {
  FileSystemNode,
  FileSystemPR,
  FileSystemPRsResponse,
} from "../../../shared/models/fileSystemTree";
import type { RepositoryDetails } from "../routes/types";

type MockFetcher<T> = {
  data?: T;
  state: "idle" | "loading" | "submitting";
  load: ReturnType<typeof vi.fn>;
};

const mockFetcher: MockFetcher<FileSystemPRsResponse> = {
  data: undefined,
  state: "idle",
  load: vi.fn(),
};

vi.mock("react-router", () => ({
  useFetcher: () => mockFetcher,
}));

vi.mock("./ContributorTable", () => ({
  ContributorTable: () => <div>Contributor table</div>,
}));

vi.mock("./ui/data-table", () => ({
  DataTable: ({
    data,
  }: {
    data: Array<{ title?: string; path?: string; gh_issue_id?: number }>;
  }) => (
    <div>
      {data.map((row, index) => (
        <div key={`${row.gh_issue_id ?? row.path ?? `row-${index}`}`}>
          {row.title ?? row.path ?? (row.gh_issue_id !== undefined ? `#${row.gh_issue_id}` : "row")}
        </div>
      ))}
    </div>
  ),
}));

vi.mock("./filesystem-related/columns", () => ({
  createRelatedEntityColumns: () => [],
}));

function createFilePR(overrides: Partial<FileSystemPR>): FileSystemPR {
  return {
    gh_issue_id: 1000,
    title: "Current path update",
    gh_login: "engineer-one",
    created_at: "2025-01-10T00:00:00.000Z",
    merged_at: "2025-01-11T00:00:00.000Z",
    additions: 8,
    deletions: 3,
    changed_files: 2,
    comments: 1,
    ...overrides,
  };
}

function createNode(overrides: Partial<FileSystemNode>): FileSystemNode {
  return {
    name: "serviceFile.ts",
    path: "services/current/serviceFile.ts",
    level: 3,
    type: "file",
    parent_path: "services/current",
    total_files: 1,
    total_adds: 12,
    total_subs: 5,
    total_changes: 17,
    total_prs: 3,
    total_contributors: 2,
    first_seen: "2024-01-01T00:00:00.000Z",
    last_updated: "2025-01-11T00:00:00.000Z",
    contributors: [],
    history: [
      {
        kind: "move",
        from_path: "services/legacy/serviceFile.ts",
        to_path: "services/mid/serviceFile.ts",
        gh_issue_id: 901,
        title: "Move file to shared area",
        merged_at: "2024-06-01T00:00:00.000Z",
      },
      {
        kind: "move",
        from_path: "services/mid/serviceFile.ts",
        to_path: "services/current/serviceFile.ts",
        gh_issue_id: 902,
        title: "Move file to current area",
        merged_at: "2024-08-01T00:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

function createRepository(): RepositoryDetails {
  return {
    id: "1",
    name: "example-repo",
    org: "example-org",
  };
}

describe("FileSystemDetail", () => {
  beforeEach(() => {
    mockFetcher.data = undefined;
    mockFetcher.state = "idle";
    mockFetcher.load.mockReset();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the include file history toggle only on recent pulls for files with history", () => {
    const repository = createRepository();

    render(
      <FileSystemDetail
        selectedNode={createNode({})}
        repository={repository}
        repositoryId="1"
        onNavigateToPath={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("Include file history")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Recent Pulls" }));
    expect(screen.getByLabelText("Include file history")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(screen.queryByLabelText("Include file history")).toBeNull();
  });

  it("does not show the include file history toggle for files without history", () => {
    const repository = createRepository();

    render(
      <FileSystemDetail
        selectedNode={createNode({ history: undefined })}
        repository={repository}
        repositoryId="1"
        onNavigateToPath={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Recent Pulls" }));
    expect(screen.queryByLabelText("Include file history")).toBeNull();
  });

  it("hydrates and caches file history PRs without duplicating rows on toggle", async () => {
    const currentPathPR = createFilePR({
      gh_issue_id: 2001,
      title: "Current path adjustment",
      created_at: "2025-03-01T00:00:00.000Z",
    });
    const historicalPR = createFilePR({
      gh_issue_id: 2002,
      title: "Earlier path migration",
      created_at: "2024-07-15T00:00:00.000Z",
      merged_at: "2024-07-16T00:00:00.000Z",
    });

    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockImplementation((input) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes(encodeURIComponent("services/current/serviceFile.ts"))) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            path: "services/current/serviceFile.ts",
            type: "file",
            prs: [currentPathPR],
            total: 1,
            limit: 25,
            offset: 0,
          }),
        } as Response);
      }

      if (url.includes(encodeURIComponent("services/legacy/serviceFile.ts"))) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            path: "services/legacy/serviceFile.ts",
            type: "file",
            prs: [historicalPR],
            total: 1,
            limit: 25,
            offset: 0,
          }),
        } as Response);
      }

      if (url.includes(encodeURIComponent("services/mid/serviceFile.ts"))) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            path: "services/mid/serviceFile.ts",
            type: "file",
            prs: [currentPathPR],
            total: 1,
            limit: 25,
            offset: 0,
          }),
        } as Response);
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const repository = createRepository();

    const { rerender } = render(
      <FileSystemDetail
        selectedNode={createNode({})}
        repository={repository}
        repositoryId="1"
        onNavigateToPath={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Recent Pulls" }));

    expect(mockFetcher.load).toHaveBeenCalledWith(
      "/app/api/filesystem/prs?repositoryId=1&path=services%2Fcurrent%2FserviceFile.ts&type=file&limit=25&offset=0",
    );

    mockFetcher.data = {
      path: "services/current/serviceFile.ts",
      type: "file",
      prs: [currentPathPR],
      total: 1,
      limit: 25,
      offset: 0,
    };

    rerender(
      <FileSystemDetail
        selectedNode={createNode({})}
        repository={repository}
        repositoryId="1"
        onNavigateToPath={vi.fn()}
      />,
    );

    expect(screen.getByText("Current path adjustment")).toBeTruthy();
    expect(screen.queryByText("Earlier path migration")).toBeNull();

    fireEvent.click(screen.getByLabelText("Include file history"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    await waitFor(() => {
      expect(screen.getByText("Earlier path migration")).toBeTruthy();
    });

    const currentRowsAfterHydrate = screen.getAllByText("Current path adjustment");
    expect(currentRowsAfterHydrate).toHaveLength(1);

    fireEvent.click(screen.getByLabelText("Include file history"));
    expect(screen.queryByText("Earlier path migration")).toBeNull();
    expect(screen.getByText("Current path adjustment")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Include file history"));

    await waitFor(() => {
      expect(screen.getByText("Earlier path migration")).toBeTruthy();
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getAllByText("Current path adjustment")).toHaveLength(1);
    expect(screen.getAllByText("Earlier path migration")).toHaveLength(1);
  });
});
