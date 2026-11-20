import * as React from "react";
import type { DataTableColumnDef as ColumnDef } from "../ui/data-table-features";
import { CellTooltip } from "../ui/cell-tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { createCenterCell, createCompactHeader, createRightCell } from "../../utils/table";
import type { RelatedEntity } from "../../../../shared/models/fileSystemTree";

interface ColumnProps {
  repoOwner?: string;
  repoName?: string;
  selectedPath?: string;
  onNavigateToPath?: (path: string) => void;
}

function getRelativeDisplayPath(fromPath: string | undefined, toPath: string): string {
  if (!fromPath) {
    return toPath;
  }

  const fromParts = fromPath.split("/");
  const fromDirectoryParts = fromParts.slice(0, -1);
  const toParts = toPath.split("/");

  let sharedLength = 0;
  while (
    sharedLength < fromDirectoryParts.length &&
    sharedLength < toParts.length &&
    fromDirectoryParts[sharedLength] === toParts[sharedLength]
  ) {
    sharedLength += 1;
  }

  const upLevels = fromDirectoryParts.length - sharedLength;
  const downParts = toParts.slice(sharedLength);
  const relativeParts = [...Array.from({ length: upLevels }, () => ".."), ...downParts];

  if (relativeParts.length === 0) {
    return toParts[toParts.length - 1] ?? toPath;
  }

  return relativeParts.join("/");
}

function RecentSharedPRsPopover({
  entity,
  repoOwner,
  repoName,
}: {
  entity: RelatedEntity;
  repoOwner?: string;
  repoName?: string;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="font-medium text-blue-400 hover:text-blue-300">
          {entity.shared_prs}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[30rem] border border-white/10 bg-[#111827] p-0 text-white shadow-2xl"
      >
        <div className="space-y-3 px-4 py-4">
          <div className="flex items-center justify-between gap-3 text-xs text-gray-400">
            <span>Most recent shared PRs</span>
            {entity.shared_prs > entity.recent_shared_prs.length && (
              <span>
                Showing last {entity.recent_shared_prs.length} of {entity.shared_prs}
              </span>
            )}
          </div>
          <div className="space-y-2">
            {entity.recent_shared_prs.map((pr: RelatedEntity["recent_shared_prs"][number]) => {
              const pullUrl =
                repoOwner && repoName
                  ? `https://github.com/${repoOwner}/${repoName}/pull/${pr.gh_issue_id}`
                  : null;
              return (
                <div
                  key={pr.gh_issue_id}
                  className="rounded-md border border-white/10 bg-[#0f172a] px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {pullUrl ? (
                        <a
                          href={pullUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-blue-400 hover:text-blue-300"
                        >
                          #{pr.gh_issue_id}
                        </a>
                      ) : (
                        <span className="text-sm font-medium text-gray-100">#{pr.gh_issue_id}</span>
                      )}
                      <p className="mt-1 break-words text-sm text-gray-200">{pr.title}</p>
                    </div>
                    <span className="whitespace-nowrap text-xs text-gray-400">
                      {new Date(pr.merged_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export const createRelatedEntityColumns = ({
  repoOwner,
  repoName,
  selectedPath,
  onNavigateToPath,
}: ColumnProps): ColumnDef<RelatedEntity>[] => [
  {
    accessorKey: "path",
    header: (props) => createCompactHeader(props, "File"),
    cell: ({ row }) => {
      const entity = row.original;
      const displayPath = getRelativeDisplayPath(selectedPath, entity.path);
      const url =
        repoOwner && repoName
          ? `https://github.com/${repoOwner}/${repoName}/${entity.type === "folder" ? "tree" : "blob"}/HEAD/${entity.path}`
          : null;

      return (
        <CellTooltip tooltip={entity.path} className="truncate">
          {onNavigateToPath ? (
            <button
              type="button"
              onClick={() => onNavigateToPath(entity.path)}
              className="block truncate text-left text-blue-400 hover:text-blue-300"
            >
              {displayPath}
            </button>
          ) : url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate text-blue-400 hover:text-blue-300"
            >
              {displayPath}
            </a>
          ) : (
            <span className="block truncate text-gray-100">{displayPath}</span>
          )}
        </CellTooltip>
      );
    },
    minSize: 260,
  },
  {
    accessorKey: "shared_prs",
    header: (props) => createCompactHeader(props, "Shared PRs"),
    cell: ({ row }) =>
      createCenterCell(
        <RecentSharedPRsPopover entity={row.original} repoOwner={repoOwner} repoName={repoName} />,
      ),
    size: 120,
  },
  {
    accessorKey: "cochange_pct",
    header: (props) => createCompactHeader(props, "Pull Share"),
    cell: ({ row }) => createRightCell(`${row.original.cochange_pct.toFixed(1)}%`),
    size: 120,
  },
];
