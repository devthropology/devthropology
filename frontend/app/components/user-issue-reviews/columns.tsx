import type {
  DataTableColumnDef as ColumnDef,
  DataTableSortFn as SortingFn,
} from "../ui/data-table-features";
import { Link } from "react-router";
import { Badge } from "../ui/badge";
import { CellTooltip } from "../ui/cell-tooltip";
import { formatCompactTime } from "../../utils/time";
import {
  createCenterCell,
  createCompactHeader,
  createRightCell,
  createTimeCell,
} from "../../utils/table";
import type { ReviewEntry } from "../../../../shared/models/userReviewStats";
import { buildContributorPath } from "../../utils/repositoryRoutes";

interface ColumnProps {
  repoOwner: string;
  repoName: string;
  repoRef?: string;
}

type PendingSortOptions = {
  pendingValue?: number;
  missingValue?: number;
};

const createPendingAwareSorter = (
  getValue: (review: ReviewEntry) => number | null | undefined,
  { pendingValue = 0, missingValue = 0 }: PendingSortOptions = {},
): SortingFn<ReviewEntry> => {
  return (rowA, rowB) => {
    const valueA = normalize(rowA.original);
    const valueB = normalize(rowB.original);

    if (valueA === valueB) {
      return 0;
    }
    return valueA > valueB ? 1 : -1;
  };

  function normalize(review: ReviewEntry): number {
    if (review.status === "Open") {
      return pendingValue;
    }

    const rawValue = getValue(review);
    if (rawValue == null) {
      return missingValue;
    }

    return rawValue;
  }
};

const getTotalLineChanges = (review: ReviewEntry) =>
  (review.additions ?? 0) + (review.deletions ?? 0);

const getLineChangeComposition = (additions: number, deletions: number) => {
  const total = additions + deletions;
  if (total === 0) {
    return {
      additionsPct: 0,
      deletionsPct: 0,
      colorClass: "text-gray-100",
    };
  }

  const additionsPct = Math.round((additions / total) * 100);
  const deletionsPct = 100 - additionsPct;

  let colorClass = "text-gray-100";
  if (additionsPct >= 70) {
    colorClass = "text-emerald-300";
  } else if (deletionsPct >= 70) {
    colorClass = "text-rose-300";
  }

  return {
    additionsPct,
    deletionsPct,
    colorClass,
  };
};

const getTotalComments = (review: ReviewEntry) =>
  review.authorComments + review.reviewerComments + review.otherUserComments + review.botComments;

const getRoundsOfReview = (review: ReviewEntry) => review.roundsOfReview ?? 0;

const getTimeToFirstReview = (review: ReviewEntry) => review.timeToFirstReview;

export const createColumns = ({
  repoOwner,
  repoName,
  repoRef,
}: ColumnProps): ColumnDef<ReviewEntry>[] => [
  {
    accessorKey: "issueId",
    header: (props) => createCompactHeader(props, "Issue"),
    cell: ({ row }) => {
      const id = row.original.issueId;
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
    maxSize: 400,
  },
  {
    accessorKey: "authorLogin",
    header: (props) => createCompactHeader(props, "Author"),
    cell: ({ row }) => {
      const author = row.original.authorLogin;
      return createCenterCell(
        <Link
          to={buildContributorPath(author, repoRef)}
          className="text-blue-400 hover:text-blue-300"
        >
          {author}
        </Link>,
      );
    },
    size: 100,
  },
  {
    accessorKey: "reviewStatus",
    header: (props) => createCompactHeader(props, "Review", "Status"),
    cell: ({ row }) => {
      const status = row.original.reviewStatus;
      const wasFirst = row.original.wasFirstReviewer;

      let colorClass = "bg-gray-600";
      if (status === "Approved") {
        colorClass = "bg-green-600";
      } else if (status === "Requested Changes") {
        colorClass = "bg-red-600";
      } else if (status === "Dismissed") {
        colorClass = "bg-amber-600";
      } else if (status === "Commented") {
        colorClass = "bg-gray-600";
      }

      // Truncate long status text for better table layout
      const displayStatus = status === "Requested Changes" ? "Changes" : status;

      return (
        <div className="flex items-center gap-1 w-full">
          <div className="w-4 flex justify-center flex-shrink-0">
            {wasFirst && (
              <span className="text-yellow-400 text-xs" title="First reviewer">
                🥇
              </span>
            )}
          </div>
          <Badge
            className={`${colorClass} hover:${colorClass} text-xs px-2 py-1 text-center flex-1 flex justify-center items-center`}
            title={status} // Show full text on hover
          >
            {displayStatus}
          </Badge>
        </div>
      );
    },
    size: 90,
  },
  {
    accessorKey: "createdAt",
    header: (props) => createCompactHeader(props, "Created"),
    cell: ({ row }) => {
      const date = new Date(row.original.createdAt);
      return (
        <CellTooltip tooltip={date.toLocaleString()} className="text-center">
          <span>{date.toLocaleDateString()}</span>
        </CellTooltip>
      );
    },
    size: 100,
  },
  {
    accessorKey: "status",
    header: (props) => createCompactHeader(props, "Status"),
    cell: ({ row }) => {
      const status = row.original.status;
      return (
        <div className="w-full flex justify-center">
          <Badge
            className={`w-full text-center flex justify-center border-2 rounded-lg px-2 py-1
                  ${
                    status === "Merged"
                      ? "bg-purple-600 hover:bg-purple-600"
                      : status === "Closed"
                        ? "bg-red-600 hover:bg-red-600"
                        : "bg-green-600 hover:bg-green-600 border-green-300 shadow-md"
                  }`}
          >
            {status}
          </Badge>
        </div>
      );
    },
    size: 90,
  },
  {
    accessorKey: "additions",
    header: (props) => createCompactHeader(props, "Lines"),
    size: 80,
    minSize: 70,
    sortFn: createPendingAwareSorter(getTotalLineChanges),
    sortUndefined: false,
    cell: ({ row }) => {
      if (row.original.status === "Open") {
        return createRightCell(<span className="text-gray-400">Pending</span>);
      }
      const additions = row.original.additions ?? 0;
      const deletions = row.original.deletions ?? 0;
      const total = additions + deletions;
      const { additionsPct, deletionsPct, colorClass } = getLineChangeComposition(
        additions,
        deletions,
      );

      return createRightCell(
        <CellTooltip
          align="right"
          className="whitespace-nowrap"
          tooltip={
            <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-1 text-left">
              <div className="text-emerald-300">Additions:</div>
              <div className="text-right tabular-nums text-white">
                {additions.toLocaleString()} ({additionsPct}%)
              </div>
              <div className="text-rose-300">Deletions:</div>
              <div className="text-right tabular-nums text-white">
                {deletions.toLocaleString()} ({deletionsPct}%)
              </div>
            </div>
          }
        >
          <div className={`whitespace-nowrap font-medium ${colorClass}`}>
            {total.toLocaleString()}
          </div>
        </CellTooltip>,
      );
    },
  },
  {
    accessorKey: "changedFiles",
    header: (props) => createCompactHeader(props, "Files"),
    sortFn: createPendingAwareSorter((review) => review.changedFiles ?? 0),
    sortUndefined: false,
    cell: ({ row }) => {
      if (row.original.status === "Open") {
        return createRightCell(<span className="text-gray-400">Pending</span>);
      }
      const files = row.original.changedFiles ?? 0;
      return createRightCell(files);
    },
    size: 70,
  },
  {
    accessorKey: "roundsOfReview",
    header: (props) => createCompactHeader(props, "Rounds"),
    sortFn: createPendingAwareSorter(getRoundsOfReview, {
      pendingValue: -1,
    }),
    sortUndefined: false,
    cell: ({ row }) => {
      const rounds = row.original.roundsOfReview ?? 0;
      const isOpen = row.original.status === "Open";

      if (isOpen) {
        return createRightCell(<span className="text-gray-400">Pending</span>);
      }

      let colorClass: string;
      if (rounds === 0) {
        colorClass = "text-gray-400";
      } else if (rounds < 2) {
        colorClass = "text-green-400";
      } else if (rounds < 4) {
        colorClass = "text-yellow-400";
      } else {
        colorClass = "text-red-400";
      }

      return createRightCell(<div className={`font-semibold ${colorClass}`}>{rounds}</div>);
    },
    size: 80,
  },
  {
    accessorKey: "comments",
    header: (props) => createCompactHeader(props, "Comments"),
    size: 120,
    minSize: 100,
    sortFn: createPendingAwareSorter(getTotalComments),
    // The accessor key is virtual; v9 otherwise skips the custom sorter for undefined values.
    sortUndefined: false,
    cell: ({ row }) => {
      if (row.original.status === "Open") {
        return createRightCell(<span className="text-gray-400">Pending</span>);
      }
      const authorComments = row.original.authorComments;
      const myComments = row.original.reviewerComments;
      const otherComments = row.original.otherUserComments;
      const botComments = row.original.botComments;
      const total = authorComments + myComments + otherComments + botComments;

      return createRightCell(
        <CellTooltip
          align="right"
          className="min-w-[70px] whitespace-nowrap"
          tooltip={
            <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-1 text-left">
              <div className="text-blue-400">Author:</div>
              <div className="text-right tabular-nums text-white">{authorComments}</div>
              <div className="text-green-400">Reviewer:</div>
              <div className="text-right tabular-nums text-white">{myComments}</div>
              <div className="text-yellow-400">Others:</div>
              <div className="text-right tabular-nums text-white">{otherComments}</div>
              <div className="text-cyan-400">Bots:</div>
              <div className="text-right tabular-nums text-white">{botComments}</div>
            </div>
          }
        >
          {total} (<span className="text-blue-400 mr-0.5">{authorComments}</span>,
          <span className="text-green-400 mr-0.5">{myComments}</span>,
          <span className="text-yellow-400 mr-0.5">{otherComments}</span>,
          <span className="text-cyan-400">{botComments}</span>)
        </CellTooltip>,
      );
    },
  },
  {
    accessorKey: "timeToFirstReview",
    header: (props) => createCompactHeader(props, "Time to", "Review"),
    sortFn: createPendingAwareSorter(getTimeToFirstReview, {
      pendingValue: 0,
      missingValue: Number.POSITIVE_INFINITY,
    }),
    sortUndefined: false,
    cell: ({ row }) => {
      if (row.original.status === "Open") {
        return createTimeCell(<span className="text-gray-400">Pending</span>, "right");
      }
      const timeHours = row.original.timeToFirstReview;

      return createTimeCell(
        timeHours !== null ? formatCompactTime(timeHours) : "No Review",
        "right",
      );
    },
    size: 100,
  },
];
