import type { DataTableColumnDef as ColumnDef } from "../ui/data-table-features";
import { CellTooltip } from "../ui/cell-tooltip";
import {
  createCenterCell,
  createCompactHeader,
  createRightCell,
  createUsernameLink,
} from "../../utils/table";
import type { FileSystemPR } from "../../../../shared/models/fileSystemTree";
import { buildContributorPath } from "../../utils/repositoryRoutes";

interface ColumnProps {
  repoOwner: string;
  repoName: string;
  repoRef?: string;
}

export const createColumns = ({
  repoOwner,
  repoName,
  repoRef,
}: ColumnProps): ColumnDef<FileSystemPR>[] => [
  {
    accessorKey: "gh_issue_id",
    header: (props) => createCompactHeader(props, "Pull"),
    cell: ({ row }) => {
      const id = row.original.gh_issue_id;
      return createCenterCell(
        <a
          href={`https://github.com/${repoOwner}/${repoName}/pull/${id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:text-blue-300"
        >
          #{id}
        </a>,
      );
    },
    size: 70,
  },
  {
    accessorKey: "title",
    header: (props) => createCompactHeader(props, "Title"),
    cell: ({ row }) => {
      const title = row.original.title;
      return (
        <CellTooltip tooltip={title} className="truncate">
          <span>{title}</span>
        </CellTooltip>
      );
    },
    minSize: 200,
    maxSize: 500,
  },
  {
    accessorKey: "gh_login",
    header: (props) => createCompactHeader(props, "Author"),
    cell: ({ row }) => {
      const login = row.original.gh_login;
      return createUsernameLink(login, buildContributorPath(login, repoRef));
    },
    size: 120,
    maxSize: 160,
  },
  {
    accessorKey: "merged_at",
    header: (props) => createCompactHeader(props, "Merged"),
    cell: ({ row }) => {
      const merged = row.original.merged_at;
      if (!merged) {
        return <div className="text-center text-gray-400">-</div>;
      }
      const date = new Date(merged);
      return (
        <CellTooltip tooltip={date.toLocaleString()} className="text-center">
          <span>{date.toLocaleDateString()}</span>
        </CellTooltip>
      );
    },
    size: 100,
  },
  {
    accessorKey: "additions",
    header: (props) => createCompactHeader(props, "Lines"),
    size: 120,
    minSize: 100,
    cell: ({ row }) => {
      const { additions, deletions } = row.original;
      const total = additions + deletions;
      return createRightCell(
        <div className="whitespace-nowrap">
          {total.toLocaleString()}
          {"  "}(<span className="text-green-400">+{additions.toLocaleString()}</span>,{" "}
          <span className="text-red-400">-{deletions.toLocaleString()}</span>)
        </div>,
      );
    },
  },
  {
    accessorKey: "changed_files",
    header: (props) => createCompactHeader(props, "Files"),
    cell: ({ row }) => createRightCell(row.original.changed_files.toLocaleString()),
    size: 70,
  },
  {
    accessorKey: "comments",
    header: (props) => createCompactHeader(props, "Comments"),
    cell: ({ row }) => createRightCell(row.original.comments),
    size: 90,
  },
];
