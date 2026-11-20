import type {
  DataTableColumnDef as ColumnDef,
  DataTableSortFn as SortingFn,
} from "../ui/data-table-features";
import { Badge } from "../ui/badge";
import { CellTooltip } from "../ui/cell-tooltip";
import { formatCompactTime } from "../../utils/time";
import {
  createCenterCell,
  createCompactHeader,
  createRightCell,
  createTimeCell,
} from "../../utils/table";

export type PullEntry = {
  issueId: number;
  title: string;
  status: "open" | "closed" | "merged";
  createdAt: string;
  closedAt?: string | null;
  additions?: number | null;
  deletions?: number | null;
  changedFiles?: number | null;
  roundsOfReview?: number | null;
  botRoundsOfReview?: number | null;
  authorComments?: number | null;
  nonAuthorComments?: number | null;
  botComments?: number | null;
  firstReviewTime?: string | null;
  firstApprovalTime?: string | null;
};

// Helper function to calculate hours between two dates
const calculateHoursBetween = (start: string, end: string | null | undefined): number | null => {
  if (!end) return null;
  const startDate = new Date(start);
  const endDate = new Date(end);
  const diffMs = endDate.getTime() - startDate.getTime();
  return diffMs / (1000 * 60 * 60);
};

type PendingSortOptions = {
  pendingValue?: number;
  missingValue?: number;
};

const createPendingAwareSorter = (
  getValue: (pull: PullEntry) => number | null | undefined,
  { pendingValue = 0, missingValue = 0 }: PendingSortOptions = {},
): SortingFn<PullEntry> => {
  return (rowA, rowB) => {
    const valueA = normalize(rowA.original);
    const valueB = normalize(rowB.original);

    if (valueA === valueB) {
      return 0;
    }
    return valueA > valueB ? 1 : -1;
  };

  function normalize(pull: PullEntry): number {
    if (pull.status === "open") {
      return pendingValue;
    }

    const rawValue = getValue(pull);
    if (rawValue == null) {
      return missingValue;
    }

    return rawValue;
  }
};

const getTotalLineChanges = (pull: PullEntry) => (pull.additions ?? 0) + (pull.deletions ?? 0);

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

const getTotalComments = (pull: PullEntry) =>
  (pull.authorComments ?? 0) + (pull.nonAuthorComments ?? 0) + (pull.botComments ?? 0);

const getRoundsOfReview = (pull: PullEntry) =>
  (pull.roundsOfReview ?? 0) + (pull.botRoundsOfReview ?? 0);

const getHoursOpen = (pull: PullEntry) => {
  if (!pull.closedAt) {
    return null;
  }
  return calculateHoursBetween(pull.createdAt, pull.closedAt);
};

const getHoursToFirstReview = (pull: PullEntry) => {
  if (!pull.firstReviewTime) {
    return null;
  }
  return calculateHoursBetween(pull.createdAt, pull.firstReviewTime);
};

const getHoursToApproval = (pull: PullEntry) => {
  if (!pull.firstApprovalTime) {
    return null;
  }
  return calculateHoursBetween(pull.createdAt, pull.firstApprovalTime);
};

interface ColumnProps {
  repoOwner: string;
  repoName: string;
}

export const createColumns = ({ repoOwner, repoName }: ColumnProps): ColumnDef<PullEntry>[] => [
  {
    accessorKey: "issueId",
    header: (props) => createCompactHeader(props, "Pull"),
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
                    status === "merged"
                      ? "bg-purple-600 hover:bg-purple-600"
                      : status === "closed"
                        ? "bg-red-600 hover:bg-red-600"
                        : "bg-green-600 hover:bg-green-600 border-green-300 shadow-md"
                  }`}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
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
      if (row.original.status === "open") {
        return createRightCell(<span className="text-gray-400">Pending</span>);
      }
      const { additions, deletions } = row.original;
      const additionsVal = additions ?? 0;
      const deletionsVal = deletions ?? 0;
      const total = additionsVal + deletionsVal;
      const { additionsPct, deletionsPct, colorClass } = getLineChangeComposition(
        additionsVal,
        deletionsVal,
      );

      return createRightCell(
        <CellTooltip
          align="right"
          className="whitespace-nowrap"
          tooltip={
            <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-1 text-left">
              <div className="text-emerald-300">Additions:</div>
              <div className="text-right tabular-nums text-white">
                {additionsVal.toLocaleString()} ({additionsPct}%)
              </div>
              <div className="text-rose-300">Deletions:</div>
              <div className="text-right tabular-nums text-white">
                {deletionsVal.toLocaleString()} ({deletionsPct}%)
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
    sortFn: createPendingAwareSorter((pull) => pull.changedFiles ?? 0),
    sortUndefined: false,
    cell: ({ row }) => {
      if (row.original.status === "open") {
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
      const humanRounds = row.original.roundsOfReview ?? 0;
      const botRounds = row.original.botRoundsOfReview ?? 0;
      const rounds = humanRounds + botRounds;
      const isPending = row.original.status === "open";

      if (isPending) {
        return createRightCell(<span className="text-gray-400">Pending</span>);
      }

      let colorClass: string;
      if (rounds < 2) {
        colorClass = "text-green-400";
      } else if (rounds < 4) {
        colorClass = "text-yellow-400";
      } else {
        colorClass = "text-red-400";
      }

      return createRightCell(
        <CellTooltip
          align="right"
          className="min-w-[40px] whitespace-nowrap"
          tooltip={
            <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-1 text-left">
              <div className="text-gray-300">Human:</div>
              <div className="text-right tabular-nums text-white">{humanRounds}</div>
              <div className="text-gray-300">Bot:</div>
              <div className="text-right tabular-nums text-white">{botRounds}</div>
            </div>
          }
        >
          <div className={`font-semibold tabular-nums ${colorClass}`}>{rounds}</div>
        </CellTooltip>,
      );
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
      if (row.original.status === "open") {
        return createRightCell(<span className="text-gray-400">Pending</span>);
      }
      const authorComments = row.original.authorComments ?? 0;
      const nonAuthorComments = row.original.nonAuthorComments ?? 0;
      const botComments = row.original.botComments ?? 0;
      const total = authorComments + nonAuthorComments + botComments;

      return createRightCell(
        <CellTooltip
          align="right"
          className="min-w-[70px] whitespace-nowrap"
          tooltip={
            <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-1 text-left">
              <div className="text-blue-400">Author:</div>
              <div className="text-right tabular-nums text-white">{authorComments}</div>
              <div className="text-yellow-400">Reviewers:</div>
              <div className="text-right tabular-nums text-white">{nonAuthorComments}</div>
              <div className="text-cyan-400">Bots:</div>
              <div className="text-right tabular-nums text-white">{botComments}</div>
            </div>
          }
        >
          {total} (<span className="text-blue-400 mr-0.5">{authorComments}</span>,
          <span className="text-yellow-400 mr-0.5">{nonAuthorComments}</span>,
          <span className="text-cyan-400">{botComments}</span>)
        </CellTooltip>,
      );
    },
  },
  {
    accessorKey: "hours_to_first_review",
    header: (props) => createCompactHeader(props, "First Human", "Review"),
    sortFn: createPendingAwareSorter(getHoursToFirstReview, {
      pendingValue: 0,
      missingValue: Number.POSITIVE_INFINITY,
    }),
    sortUndefined: false,
    cell: ({ row }) => {
      const created = row.original.createdAt;
      const firstReviewTime = row.original.firstReviewTime;
      const status = row.original.status;

      const hours = firstReviewTime ? calculateHoursBetween(created, firstReviewTime) : null;

      return createTimeCell(
        hours !== null ? (
          formatCompactTime(hours)
        ) : status !== "open" ? (
          "N/A"
        ) : (
          <span className="text-gray-400">Pending</span>
        ),
        "right",
      );
    },
    size: 115,
  },
  {
    accessorKey: "hours_to_approval",
    header: (props) => createCompactHeader(props, "Approval", "Time"),
    sortFn: createPendingAwareSorter(getHoursToApproval, {
      pendingValue: 0,
      missingValue: Number.POSITIVE_INFINITY,
    }),
    sortUndefined: false,
    cell: ({ row }) => {
      if (row.original.status === "open") {
        return createTimeCell(<span className="text-gray-400">Pending</span>, "right");
      }

      const approvalTime = row.original.firstApprovalTime;
      const hours = approvalTime
        ? calculateHoursBetween(row.original.createdAt, approvalTime)
        : null;

      return createTimeCell(hours !== null ? formatCompactTime(hours) : "N/A", "right");
    },
    size: 100,
  },
  {
    accessorKey: "hours_open",
    header: (props) => createCompactHeader(props, "Time", "Open"),
    sortFn: createPendingAwareSorter(getHoursOpen, {
      pendingValue: 0,
      missingValue: Number.POSITIVE_INFINITY,
    }),
    sortUndefined: false,
    cell: ({ row }) => {
      const created = new Date(row.original.createdAt);
      const closed = row.original.closedAt ? new Date(row.original.closedAt) : null;
      const hoursOpen = closed
        ? calculateHoursBetween(row.original.createdAt, row.original.closedAt)
        : null;
      const isPending = row.original.status === "open";

      if (isPending) {
        return (
          <div className="text-right">
            <span className="text-gray-400">Pending</span>
          </div>
        );
      }
      if (hoursOpen !== null) {
        return (
          <CellTooltip
            align="right"
            className="text-right"
            tooltip={
              <>
                <strong>Opened:</strong> {created.toLocaleString()} <br />
                <strong>Closed:</strong> {closed?.toLocaleString()} <br />
                <strong>Duration:</strong> {Math.floor(hoursOpen / 24)} days,{" "}
                {Math.floor(hoursOpen % 24)} hours
              </>
            }
          >
            <span>{formatCompactTime(hoursOpen)}</span>
          </CellTooltip>
        );
      }
      return (
        <div className="text-right">
          <span className="text-gray-400">Open</span>
        </div>
      );
    },
    size: 90,
  },
];
