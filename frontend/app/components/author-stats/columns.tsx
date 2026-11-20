import type { DataTableColumnDef as ColumnDef } from "../ui/data-table-features";
import type { MetricCategory } from "../../../../shared/models/metrics";
import type { AuthorStats } from "../../../../shared/models/authorStats";
import { formatTime } from "../../utils/time";
import { formatMetricValue } from "../../utils/numberFormat";
import { createCompactHeader, createStandardHeader, createUsernameLink } from "../../utils/table";
import { cn } from "../../lib/utils";
import { buildRepoScopedPath } from "../../utils/repositoryRoutes";

const CATEGORY_STYLES: Record<MetricCategory, string> = {
  elite: "border-l-[5px] border-emerald-500 rounded-l-sm",
  high: "border-l-[5px] border-blue-500 rounded-l-sm",
  average: "",
  low: "border-l-[5px] border-orange-500 rounded-l-sm",
  "at-risk": "border-l-[5px] border-red-500 rounded-l-sm",
  unknown: "",
};

function getMetricClass(category: MetricCategory) {
  return cn("px-2", CATEGORY_STYLES[category]);
}

const THRESHOLD_LABELS = ["Top", "High", "Middle", "Low", "Bottom"];

function formatMetricNumber(value: number) {
  if (Number.isInteger(value)) {
    return value.toLocaleString();
  }

  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function MetricCenterCell({
  value,
  className,
  formatter = formatMetricNumber,
}: {
  value: number | null;
  className: string;
  formatter?: (value: number) => string;
}) {
  return (
    <div className={cn("text-center text-base", className)}>
      {value == null ? "-" : formatter(value)}
    </div>
  );
}

function MetricTimeCell({ value, className }: { value: string; className: string }) {
  return <div className={cn("text-right text-base", className)}>{value}</div>;
}

function formatRoundedCount(value: number) {
  return Math.round(value).toLocaleString();
}

function MetricTotalLinesCell({
  additions,
  deletions,
  className,
}: {
  additions: number | null;
  deletions: number | null;
  className: string;
}) {
  if (additions == null || deletions == null) {
    return <div className={cn("text-center text-base", className)}>-</div>;
  }

  const total = additions + deletions;

  return (
    <div className={cn("text-center text-base whitespace-nowrap", className)}>
      {formatMetricValue(total)} (
      <span className="text-green-400">+{formatMetricValue(additions)}</span>,{" "}
      <span className="text-red-400">-{formatMetricValue(deletions)}</span>)
    </div>
  );
}

function getContributorPath(author: string, repoRef?: string): string {
  return repoRef
    ? buildRepoScopedPath(repoRef, `/explore/contributors/${author}`)
    : `/app/explore/contributors/${author}`;
}

export function createColumns(repoRef?: string, linkContributors = true): ColumnDef<AuthorStats>[] {
  return [
    {
      accessorKey: "author",
      header: (props) => createStandardHeader(props, "Author"),
      cell: ({ row }) => {
        const author = row.getValue("author") as string;
        if (THRESHOLD_LABELS.includes(author)) {
          return <span className="text-gray-400 font-medium">{author}</span>;
        }
        return linkContributors ? (
          createUsernameLink(author, getContributorPath(author, repoRef))
        ) : (
          <span>{author}</span>
        );
      },
      size: 140,
      maxSize: 180,
    },
    {
      id: "merged_prs_count",
      accessorFn: (row) => row.merged_prs_count.value,
      header: (props) => createCompactHeader(props, "Merged", "PRs"),
      size: 70,
      cell: ({ row }) => {
        const metric = row.original.merged_prs_count;
        return (
          <MetricCenterCell value={metric.value} className={getMetricClass(metric.category)} />
        );
      },
    },
    {
      id: "active_days",
      accessorFn: (row) => row.active_days.value,
      header: (props) => createCompactHeader(props, "Active", "Days"),
      size: 70,
      cell: ({ row }) => {
        const metric = row.original.active_days;
        return (
          <MetricCenterCell value={metric.value} className={getMetricClass(metric.category)} />
        );
      },
    },
    {
      id: "avg_pr_per_active_day",
      accessorFn: (row) => row.avg_pr_per_active_day.value,
      header: (props) => createCompactHeader(props, "Merged PRs/", "Active Day"),
      size: 80,
      cell: ({ row }) => {
        const metric = row.original.avg_pr_per_active_day;
        return (
          <MetricCenterCell value={metric.value} className={getMetricClass(metric.category)} />
        );
      },
    },
    {
      id: "open_prs_count",
      accessorFn: (row) => row.open_prs_count.value,
      header: (props) => createCompactHeader(props, "PRs", "Created"),
      size: 70,
      cell: ({ row }) => {
        const metric = row.original.open_prs_count;
        return (
          <MetricCenterCell value={metric.value} className={getMetricClass(metric.category)} />
        );
      },
    },
    {
      id: "avg_rounds_of_review",
      accessorFn: (row) => row.avg_rounds_of_review.value,
      header: (props) => createCompactHeader(props, "Avg Review", "Rounds"),
      size: 90,
      cell: ({ row }) => {
        const metric = row.original.avg_rounds_of_review;
        return (
          <MetricCenterCell value={metric.value} className={getMetricClass(metric.category)} />
        );
      },
    },
    {
      id: "avg_time_to_first_review",
      accessorFn: (row) => row.avg_time_to_first_review.value,
      header: (props) => createCompactHeader(props, "Avg Time", "First Review"),
      cell: ({ row }) => {
        const metric = row.original.avg_time_to_first_review;
        return (
          <MetricTimeCell
            value={formatTime(metric.value)}
            className={getMetricClass(metric.category)}
          />
        );
      },
      size: 100,
    },
    {
      id: "median_time_to_first_review",
      accessorFn: (row) => row.median_time_to_first_review.value,
      header: (props) => createCompactHeader(props, "Median Time", "First Review"),
      cell: ({ row }) => {
        const metric = row.original.median_time_to_first_review;
        return (
          <MetricTimeCell
            value={formatTime(metric.value)}
            className={getMetricClass(metric.category)}
          />
        );
      },
      size: 100,
    },
    {
      id: "avg_time_to_merge",
      accessorFn: (row) => row.avg_time_to_merge.value,
      header: (props) => createCompactHeader(props, "Avg Time", "to Merge"),
      cell: ({ row }) => {
        const metric = row.original.avg_time_to_merge;
        return (
          <MetricTimeCell
            value={formatTime(metric.value)}
            className={getMetricClass(metric.category)}
          />
        );
      },
      size: 100,
    },
    {
      id: "median_time_to_merge",
      accessorFn: (row) => row.median_time_to_merge.value,
      header: (props) => createCompactHeader(props, "Median Time", "to Merge"),
      cell: ({ row }) => {
        const metric = row.original.median_time_to_merge;
        return (
          <MetricTimeCell
            value={formatTime(metric.value)}
            className={getMetricClass(metric.category)}
          />
        );
      },
      size: 100,
    },
    {
      id: "avg_comments_per_pr",
      accessorFn: (row) => row.avg_comments_per_pr.value,
      header: (props) => createCompactHeader(props, "Avg", "Comments/PR"),
      size: 100,
      cell: ({ row }) => {
        const metric = row.original.avg_comments_per_pr;
        return (
          <MetricCenterCell value={metric.value} className={getMetricClass(metric.category)} />
        );
      },
    },
    {
      id: "median_comments_per_pr",
      accessorFn: (row) => row.median_comments_per_pr.value,
      header: (props) => createCompactHeader(props, "Median", "Comments/PR"),
      size: 110,
      cell: ({ row }) => {
        const metric = row.original.median_comments_per_pr;
        return (
          <MetricCenterCell
            value={metric.value}
            className={getMetricClass(metric.category)}
            formatter={formatRoundedCount}
          />
        );
      },
    },
    {
      id: "total_comments_merged",
      accessorFn: (row) => row.total_comments_merged.value,
      header: (props) => createCompactHeader(props, "Total Comments", "Received"),
      size: 110,
      cell: ({ row }) => {
        const metric = row.original.total_comments_merged;
        return (
          <MetricCenterCell value={metric.value} className={getMetricClass(metric.category)} />
        );
      },
    },
    {
      id: "avg_files_changed",
      accessorFn: (row) => row.avg_files_changed.value,
      header: (props) => createCompactHeader(props, "Avg", "Files/PR"),
      size: 90,
      cell: ({ row }) => {
        const metric = row.original.avg_files_changed;
        return (
          <MetricCenterCell value={metric.value} className={getMetricClass(metric.category)} />
        );
      },
    },
    {
      id: "median_files_changed",
      accessorFn: (row) => row.median_files_changed.value,
      header: (props) => createCompactHeader(props, "Median", "Files/PR"),
      size: 100,
      cell: ({ row }) => {
        const metric = row.original.median_files_changed;
        return (
          <MetricCenterCell
            value={metric.value}
            className={getMetricClass(metric.category)}
            formatter={formatRoundedCount}
          />
        );
      },
    },
    {
      id: "avg_lines_changed",
      accessorFn: (row) => row.avg_lines_changed.value,
      header: (props) => createCompactHeader(props, "Avg", "Lines/PR"),
      size: 90,
      cell: ({ row }) => {
        const metric = row.original.avg_lines_changed;
        return (
          <MetricCenterCell value={metric.value} className={getMetricClass(metric.category)} />
        );
      },
    },
    {
      id: "median_lines_changed",
      accessorFn: (row) => row.median_lines_changed.value,
      header: (props) => createCompactHeader(props, "Median", "Lines/PR"),
      size: 100,
      cell: ({ row }) => {
        const metric = row.original.median_lines_changed;
        return (
          <MetricCenterCell
            value={metric.value}
            className={getMetricClass(metric.category)}
            formatter={formatRoundedCount}
          />
        );
      },
    },
    {
      id: "total_lines_changed",
      accessorFn: (row) => {
        const additions = row.total_additions.value;
        const deletions = row.total_deletions.value;
        return additions == null || deletions == null ? null : additions + deletions;
      },
      header: (props) => createCompactHeader(props, "Total Lines", "Changed"),
      size: 140,
      cell: ({ row }) => {
        return (
          <MetricTotalLinesCell
            additions={row.original.total_additions.value}
            deletions={row.original.total_deletions.value}
            className={getMetricClass(row.original.total_additions.category)}
          />
        );
      },
    },
    {
      id: "unique_files_touched_count",
      accessorFn: (row) => row.unique_files_touched_count.value,
      header: (props) => createCompactHeader(props, "Unique Files", "Changed"),
      size: 100,
      cell: ({ row }) => {
        const metric = row.original.unique_files_touched_count;
        return (
          <MetricCenterCell value={metric.value} className={getMetricClass(metric.category)} />
        );
      },
    },
    {
      accessorKey: "top_touched_package",
      header: (props) => createCompactHeader(props, "Top Touched", "Package"),
      size: 120,
      cell: ({ row }) => {
        const value = row.getValue("top_touched_package") as string | null;
        return <div className="text-center text-base">{value ?? "-"}</div>;
      },
    },
  ];
}

export const columns = createColumns();
