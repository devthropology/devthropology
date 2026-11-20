import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useFetcher } from "react-router";
import { File, Folder } from "lucide-react";
import type { DataTableColumnDef as ColumnDef } from "./ui/data-table-features";
import { ContributorTable } from "./ContributorTable";
import { DataTable } from "./ui/data-table";
import { createColumns } from "./filesystem-prs/columns";
import { createRelatedEntityColumns } from "./filesystem-related/columns";
import { createCenterCell, createCompactHeader, createRightCell } from "../utils/table";
import type {
  FileHistoryEvent,
  FileSystemNode,
  FileSystemPR,
  FileSystemPRsResponse,
  RelatedEntity,
} from "../../../shared/models/fileSystemTree";
import type { RepositoryDetails } from "../routes/types";

const PAGE_SIZE = 25;

type DetailTab = "contributors" | "prs" | "related" | "history";

function SegmentedControl({
  activeTab,
  onTabChange,
  showRelatedTab,
  hasRelatedFiles,
  showHistoryTab,
  hasHistory,
  showIncludeHistoryToggle,
  includeFileHistory,
  onIncludeFileHistoryChange,
}: {
  activeTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  showRelatedTab: boolean;
  hasRelatedFiles: boolean;
  showHistoryTab: boolean;
  hasHistory: boolean;
  showIncludeHistoryToggle: boolean;
  includeFileHistory: boolean;
  onIncludeFileHistoryChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex gap-1 p-1 bg-gray-800 rounded-lg w-fit">
        <button
          type="button"
          onClick={() => onTabChange("contributors")}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200 ${
            activeTab === "contributors"
              ? "bg-blue-600 text-white shadow-md"
              : "text-gray-300 hover:text-white hover:bg-gray-700"
          }`}
        >
          Contributors
        </button>
        <button
          type="button"
          onClick={() => onTabChange("prs")}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200 ${
            activeTab === "prs"
              ? "bg-blue-600 text-white shadow-md"
              : "text-gray-300 hover:text-white hover:bg-gray-700"
          }`}
        >
          Recent Pulls
        </button>
        {showRelatedTab && (
          <button
            type="button"
            disabled={!hasRelatedFiles}
            onClick={() => onTabChange("related")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200 ${
              activeTab === "related"
                ? "bg-blue-600 text-white shadow-md"
                : hasRelatedFiles
                  ? "text-gray-300 hover:text-white hover:bg-gray-700"
                  : "cursor-not-allowed text-gray-500"
            }`}
            title={hasRelatedFiles ? undefined : "No related files available"}
          >
            Related Files
          </button>
        )}
        {showHistoryTab && (
          <button
            type="button"
            disabled={!hasHistory}
            onClick={() => onTabChange("history")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200 ${
              activeTab === "history"
                ? "bg-blue-600 text-white shadow-md"
                : hasHistory
                  ? "text-gray-300 hover:text-white hover:bg-gray-700"
                  : "cursor-not-allowed text-gray-500"
            }`}
            title={hasHistory ? undefined : "No history available"}
          >
            History
          </button>
        )}
      </div>

      {showIncludeHistoryToggle && (
        <label
          className="flex items-center gap-2 text-sm text-gray-300 whitespace-nowrap"
          title="Includes PRs from earlier names and locations for this file."
        >
          <input
            type="checkbox"
            checked={includeFileHistory}
            onChange={(event) => onIncludeFileHistoryChange(event.target.checked)}
            className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500"
          />
          <span>Include file history</span>
        </label>
      )}
    </div>
  );
}

function HistoryPanel({
  history,
  repository,
}: {
  history: FileHistoryEvent[];
  repository: RepositoryDetails | null;
}) {
  const eventLabels: Record<FileHistoryEvent["kind"], string> = {
    rename: "Renamed",
    move: "Moved",
    move_and_rename: "Moved + Renamed",
  };

  const historyColumns = useMemo<ColumnDef<FileHistoryEvent>[]>(
    () => [
      {
        accessorKey: "kind",
        header: (props) => createCompactHeader(props, "Type"),
        cell: ({ row }) => <span className="text-gray-100">{eventLabels[row.original.kind]}</span>,
        size: 150,
      },
      {
        accessorKey: "from_path",
        header: (props) => createCompactHeader(props, "From"),
        cell: ({ row }) => (
          <span className="block truncate text-gray-200" title={row.original.from_path}>
            {row.original.from_path}
          </span>
        ),
        minSize: 300,
      },
      {
        accessorKey: "to_path",
        header: (props) => createCompactHeader(props, "To"),
        cell: ({ row }) => (
          <span className="block truncate text-white" title={row.original.to_path}>
            {row.original.to_path}
          </span>
        ),
        minSize: 300,
      },
      {
        accessorKey: "gh_issue_id",
        header: (props) => createCompactHeader(props, "PR"),
        cell: ({ row }) => {
          const pullUrl = repository
            ? `https://github.com/${repository.org}/${repository.name}/pull/${row.original.gh_issue_id}`
            : null;

          if (!pullUrl) {
            return createCenterCell(
              <span className="text-gray-100">#{row.original.gh_issue_id}</span>,
            );
          }

          return createCenterCell(
            <a
              href={pullUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300"
            >
              #{row.original.gh_issue_id}
            </a>,
          );
        },
        size: 90,
      },
      {
        accessorKey: "merged_at",
        header: (props) => createCompactHeader(props, "Merged"),
        cell: ({ row }) =>
          createRightCell(
            <span className="text-gray-300">
              {new Date(row.original.merged_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>,
          ),
        size: 130,
      },
    ],
    [eventLabels, repository],
  );

  return (
    <DataTable
      columns={historyColumns}
      data={history}
      maxHeight="100%"
      showCustomHorizontalScrollbar
    />
  );
}

function RelatedEntitiesPanel({
  entities,
  repository,
  selectedPath,
  onNavigateToPath,
}: {
  entities: RelatedEntity[];
  repository: RepositoryDetails | null;
  selectedPath?: string;
  onNavigateToPath: (path: string) => void;
}) {
  const relatedColumns = useMemo(
    () =>
      createRelatedEntityColumns({
        repoOwner: repository?.org,
        repoName: repository?.name,
        selectedPath,
        onNavigateToPath,
      }),
    [onNavigateToPath, repository?.name, repository?.org, selectedPath],
  );

  if (entities.length === 0) {
    return (
      <div className="flex items-center justify-center h-20 text-gray-400 text-sm">
        No related files met the current co-change threshold
      </div>
    );
  }

  return (
    <DataTable
      columns={relatedColumns}
      data={entities}
      maxHeight="100%"
      showCustomHorizontalScrollbar
    />
  );
}

interface FileSystemDetailProps {
  selectedNode: FileSystemNode | null;
  repository: RepositoryDetails | null;
  repositoryId: string;
  onNavigateToPath: (path: string) => void;
}

export function FileSystemDetail({
  selectedNode,
  repository,
  repositoryId,
  onNavigateToPath,
}: FileSystemDetailProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>("contributors");
  const [includeFileHistory, setIncludeFileHistory] = useState(false);
  const [isHydratingHistoryPRs, setIsHydratingHistoryPRs] = useState(false);
  const showRelatedTab = selectedNode?.type === "file";
  const relatedEntities = selectedNode?.related_entities ?? [];
  const hasRelatedFiles = relatedEntities.length > 0;
  const fileHistory = selectedNode?.history ?? [];
  const showHistoryTab = selectedNode?.type === "file";
  const hasHistory = fileHistory.length > 0;
  const showIncludeHistoryToggle = activeTab === "prs" && showHistoryTab && hasHistory;

  // PR infinite scroll state
  const [currentPathPRs, setCurrentPathPRs] = useState<FileSystemPR[]>([]);
  const [currentPathPRsHasMore, setCurrentPathPRsHasMore] = useState(false);
  const [historicalPRs, setHistoricalPRs] = useState<FileSystemPR[]>([]);
  const [hasLoadedHistoricalPRs, setHasLoadedHistoricalPRs] = useState(false);
  const prsOffsetRef = useRef(0);
  const historyRequestIdRef = useRef(0);
  const prsFetcher = useFetcher<FileSystemPRsResponse>();

  // Track which node the current PR data belongs to, so we can reset on selection change
  const currentPRPathRef = useRef<string | null>(null);

  // Reset PR state when selected node changes
  useEffect(() => {
    setIncludeFileHistory(false);
    setIsHydratingHistoryPRs(false);
    setCurrentPathPRs([]);
    setCurrentPathPRsHasMore(false);
    setHistoricalPRs([]);
    setHasLoadedHistoricalPRs(false);
    prsOffsetRef.current = 0;
    currentPRPathRef.current = null;
    historyRequestIdRef.current += 1;
  }, [selectedNode?.path]);

  useEffect(() => {
    if (activeTab === "related" && (!showRelatedTab || !hasRelatedFiles)) {
      setActiveTab("contributors");
      return;
    }

    if (activeTab === "history" && (!showHistoryTab || !hasHistory)) {
      setActiveTab("contributors");
    }
  }, [activeTab, hasHistory, hasRelatedFiles, showHistoryTab, showRelatedTab]);

  // Load initial PRs when switching to the PRs tab
  useEffect(() => {
    if (activeTab !== "prs" || !selectedNode) return;
    if (includeFileHistory && selectedNode.type === "file" && fileHistory.length > 0) {
      return;
    }
    // Only fetch if we haven't loaded for this path yet
    if (currentPRPathRef.current === selectedNode.path) return;

    currentPRPathRef.current = selectedNode.path;
    prsOffsetRef.current = 0;

    const type = selectedNode.type;
    const encodedRepositoryId = encodeURIComponent(repositoryId);
    void prsFetcher.load(
      `/app/api/filesystem/prs?repositoryId=${encodedRepositoryId}&path=${encodeURIComponent(selectedNode.path)}&type=${type}&limit=${PAGE_SIZE}&offset=0`,
    );
  }, [activeTab, fileHistory.length, includeFileHistory, repositoryId, selectedNode]);

  useEffect(() => {
    if (activeTab !== "prs" || !selectedNode) return;
    if (!includeFileHistory || selectedNode.type !== "file" || fileHistory.length === 0) return;
    if (hasLoadedHistoricalPRs) return;

    const requestId = ++historyRequestIdRef.current;
    setIsHydratingHistoryPRs(true);

    const uniquePaths = Array.from(
      new Set([
        selectedNode.path,
        ...fileHistory.map((event) => event.from_path),
        ...fileHistory.map((event) => event.to_path),
      ]),
    );

    const fetchAllPagesForPath = async (path: string) => {
      const results: FileSystemPR[] = [];
      let offset = 0;

      while (true) {
        const encodedRepositoryId = encodeURIComponent(repositoryId);
        const response = await fetch(
          `/app/api/filesystem/prs?repositoryId=${encodedRepositoryId}&path=${encodeURIComponent(path)}&type=file&limit=${PAGE_SIZE}&offset=${offset}`,
        );
        if (!response.ok) {
          throw new Error(`Failed to fetch PRs for ${path}`);
        }

        const data = (await response.json()) as FileSystemPRsResponse;
        results.push(...(data.prs ?? []));

        if (!data.prs || data.prs.length < PAGE_SIZE) {
          break;
        }

        offset += data.prs.length;
      }

      return results;
    };

    void Promise.all(uniquePaths.map((path) => fetchAllPagesForPath(path)))
      .then((responses) => {
        if (historyRequestIdRef.current !== requestId) {
          return;
        }

        const dedupedPRs = Array.from(
          responses
            .flat()
            .reduce((map, pr) => {
              const existing = map.get(pr.gh_issue_id);
              if (
                !existing ||
                new Date(pr.created_at).getTime() > new Date(existing.created_at).getTime()
              ) {
                map.set(pr.gh_issue_id, pr);
              }
              return map;
            }, new Map<number, FileSystemPR>())
            .values(),
        ).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        setHistoricalPRs(dedupedPRs);
        setHasLoadedHistoricalPRs(true);
        setIsHydratingHistoryPRs(false);
      })
      .catch((error) => {
        if (historyRequestIdRef.current !== requestId) {
          return;
        }
        console.error("Error hydrating file-history PRs:", error);
        setIsHydratingHistoryPRs(false);
      });
  }, [
    activeTab,
    fileHistory,
    hasLoadedHistoricalPRs,
    includeFileHistory,
    repositoryId,
    selectedNode,
  ]);

  // Append fetcher results
  useEffect(() => {
    if (!prsFetcher.data) return;

    const data = prsFetcher.data;
    const newPRs = data.prs ?? [];

    if (prsOffsetRef.current === 0) {
      // First page — replace
      setCurrentPathPRs(newPRs);
    } else {
      // Subsequent pages — append
      setCurrentPathPRs((prev) => {
        const seen = new Set(prev.map((pr) => pr.gh_issue_id));
        const dedupedNewPRs = newPRs.filter((pr) => !seen.has(pr.gh_issue_id));
        return [...prev, ...dedupedNewPRs];
      });
    }

    prsOffsetRef.current += newPRs.length;
    setCurrentPathPRsHasMore(newPRs.length >= PAGE_SIZE);
  }, [prsFetcher.data]);

  // Load more callback for DataTable infinite scroll
  const loadMorePRs = useCallback(() => {
    if (prsFetcher.state !== "idle" || !currentPathPRsHasMore || !selectedNode) return;

    const type = selectedNode.type;
    const encodedRepositoryId = encodeURIComponent(repositoryId);
    void prsFetcher.load(
      `/app/api/filesystem/prs?repositoryId=${encodedRepositoryId}&path=${encodeURIComponent(selectedNode.path)}&type=${type}&limit=${PAGE_SIZE}&offset=${prsOffsetRef.current}`,
    );
  }, [currentPathPRsHasMore, prsFetcher, repositoryId, selectedNode]);

  if (!selectedNode) {
    return (
      <div className="flex items-center justify-center h-32 text-gray-400">
        <div className="text-center">
          <File className="h-12 w-12 mx-auto mb-2 opacity-50" />
          <p>Select a file or folder to view details</p>
        </div>
      </div>
    );
  }

  const formatNumber = (num: number) => {
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + "k";
    }
    return num.toString();
  };

  const getIcon = () => {
    if (selectedNode.type === "folder") {
      return <Folder className="h-5 w-5 text-blue-400 flex-shrink-0" />;
    }
    return <File className="h-5 w-5 text-gray-400 flex-shrink-0" />;
  };

  const formatMonthYear = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });
  };

  /** Directory portion of the path (everything before the file/folder name). */
  const parentPath = (() => {
    const lastSlash = selectedNode.path.lastIndexOf("/");
    if (lastSlash <= 0) return "";
    return selectedNode.path.substring(0, lastSlash + 1);
  })();

  const getHealthColor = () => {
    if (!selectedNode.health || selectedNode.health.state === "neutral") {
      return "text-gray-400";
    }
    switch (selectedNode.health.state) {
      case "good":
        return "text-green-400";
      case "caution":
        return "text-yellow-400";
      case "warn":
        return "text-orange-400";
      case "critical":
        return "text-red-400";
      default:
        return "text-gray-400";
    }
  };

  const getHealthLabel = (state: string): string => {
    switch (state) {
      case "critical":
        return "Unowned";
      case "warn":
        return "Ownership Risk";
      case "caution":
        return "Dormant";
      case "good":
        return "Active";
      default:
        return "Stable";
    }
  };

  const prColumns = repository
    ? createColumns({ repoOwner: repository.org, repoName: repository.name, repoRef: repositoryId })
    : createColumns({ repoOwner: "", repoName: "", repoRef: repositoryId });
  const displayedPRs =
    includeFileHistory && hasLoadedHistoricalPRs ? historicalPRs : currentPathPRs;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Compact Header */}
      <div className="flex-shrink-0 border-b border-gray-600 pb-3 mb-3">
        {/* Line 1: Icon + Name (linked to GitHub) + Parent Path */}
        <div className="flex items-center gap-2 min-w-0">
          {getIcon()}
          {repository ? (
            <a
              href={`https://github.com/${repository.org}/${repository.name}/tree/HEAD/${selectedNode.path}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-lg font-semibold text-blue-400 hover:text-blue-300 truncate flex-shrink-0"
            >
              {selectedNode.name}
            </a>
          ) : (
            <h2 className="text-lg font-semibold text-white truncate flex-shrink-0">
              {selectedNode.name}
            </h2>
          )}
          {parentPath && (
            <span className="text-sm text-gray-500 truncate min-w-0" title={selectedNode.path}>
              {parentPath}
            </span>
          )}
        </div>

        {/* Line 2: LABEL — Reason (hidden for neutral) */}
        {selectedNode.health && selectedNode.health.state !== "neutral" && (
          <p className="mt-1 text-xs truncate pl-7" title={selectedNode.health.reason || undefined}>
            <span className={`${getHealthColor()} font-semibold`}>
              {getHealthLabel(selectedNode.health.state)}
            </span>
            {selectedNode.health.reason && (
              <>
                <span className="text-gray-500"> — </span>
                <span className="text-gray-400">{selectedNode.health.reason}</span>
              </>
            )}
          </p>
        )}

        {/* Line 3: Compact stats summary */}
        <div className="mt-1.5 text-xs text-gray-400 pl-7 flex flex-wrap items-center gap-x-1">
          <span>
            <span className="text-gray-300">{formatNumber(selectedNode.total_prs)}</span> PRs
          </span>
          <span>
            (<span className="text-green-400">+{formatNumber(selectedNode.total_adds)}</span>,{" "}
            <span className="text-red-400">-{formatNumber(selectedNode.total_subs)}</span>)
          </span>
          <span className="text-gray-600 mx-0.5">·</span>
          <span>
            <span className="text-gray-300">{selectedNode.total_contributors}</span> contributors
          </span>
          {selectedNode.type === "folder" && (
            <>
              <span className="text-gray-600 px-1.5">|</span>
              <span>
                <span className="text-gray-300">{formatNumber(selectedNode.total_files)}</span>{" "}
                files
              </span>
            </>
          )}
          <span className="text-gray-600 px-1.5">|</span>
          <span>
            {formatMonthYear(selectedNode.first_seen)} –{" "}
            {formatMonthYear(selectedNode.last_updated)}
          </span>
        </div>
      </div>

      {/* Tab content area */}
      <div className="flex flex-1 min-h-0 flex-col">
        <div className="mb-3 flex-shrink-0">
          <SegmentedControl
            activeTab={activeTab}
            onTabChange={setActiveTab}
            showRelatedTab={showRelatedTab}
            hasRelatedFiles={hasRelatedFiles}
            showHistoryTab={showHistoryTab}
            hasHistory={hasHistory}
            showIncludeHistoryToggle={showIncludeHistoryToggle}
            includeFileHistory={includeFileHistory}
            onIncludeFileHistoryChange={setIncludeFileHistory}
          />
        </div>

        <div className="flex-1 min-h-0">
          {activeTab === "contributors" && (
            <>
              {selectedNode.contributors && selectedNode.contributors.length > 0 ? (
                <ContributorTable contributors={selectedNode.contributors} />
              ) : (
                <div className="flex items-center justify-center h-20 text-gray-400 text-sm">
                  No contributor data available
                </div>
              )}
            </>
          )}

          {activeTab === "prs" && (
            <>
              {displayedPRs.length > 0 ? (
                <DataTable
                  columns={prColumns}
                  data={displayedPRs}
                  maxHeight="100%"
                  showCustomHorizontalScrollbar
                  onScrollNearEnd={
                    includeFileHistory ? undefined : currentPathPRsHasMore ? loadMorePRs : undefined
                  }
                  isLoadingMore={
                    includeFileHistory ? isHydratingHistoryPRs : prsFetcher.state !== "idle"
                  }
                />
              ) : (includeFileHistory ? isHydratingHistoryPRs : prsFetcher.state !== "idle") ? (
                <div className="flex items-center justify-center h-20 text-gray-400 text-sm">
                  Loading PRs...
                </div>
              ) : (
                <div className="flex items-center justify-center h-20 text-gray-400 text-sm">
                  No PRs found for this path
                </div>
              )}
            </>
          )}

          {activeTab === "related" && (
            <RelatedEntitiesPanel
              entities={relatedEntities}
              repository={repository}
              selectedPath={selectedNode?.path}
              onNavigateToPath={onNavigateToPath}
            />
          )}

          {activeTab === "history" && showHistoryTab && hasHistory && (
            <HistoryPanel history={fileHistory} repository={repository} />
          )}
        </div>
      </div>
    </div>
  );
}
