import type { DataTableColumnDef as ColumnDef } from "../ui/data-table-features";
import type { MetricCategory } from "../../../../shared/models/metrics";
import type { ReviewerStats } from "../../../../shared/models/reviewerStats";
import { formatTime } from "../../utils/time";
import { createCompactHeader, createStandardHeader, createUsernameLink } from "../../utils/table";
import { cn } from "../../lib/utils";
import { buildRepoScopedPath } from "../../utils/repositoryRoutes";

// Refined color palette for performance tiers
// Green = Best, Blue = High, Orange = Low, Red = At-Risk
// Using left-border bar accent for clean visual distinction
const CATEGORY_STYLES: Record<MetricCategory, string> = {
  elite: "border-l-[5px] border-emerald-500 rounded-l-sm", // Top 10% - green
  high: "border-l-[5px] border-blue-500 rounded-l-sm", // 75-90% - blue
  average: "", // 25-75% - no styling
  low: "border-l-[5px] border-orange-500 rounded-l-sm", // 10-25% - orange
  "at-risk": "border-l-[5px] border-red-500 rounded-l-sm", // Bottom 10% - red
  unknown: "",
};

function getMetricClass(category: MetricCategory) {
  return cn("px-2", CATEGORY_STYLES[category]);
}

// Threshold/ghost row labels that should not be hyperlinked
const THRESHOLD_LABELS = ["Top", "High", "Middle", "Low", "Bottom"];

// Helper components for metric cells
function MetricCenterCell({ value, className }: { value: number | null; className: string }) {
  return (
    <div className={cn("text-center", className)}>
      {value != null ? value.toLocaleString() : "-"}
    </div>
  );
}

function MetricTimeCell({ value, className }: { value: string; className: string }) {
  return <div className={cn("text-right text-base", className)}>{value}</div>;
}

function getContributorPath(username: string, repoRef?: string): string {
  return repoRef
    ? buildRepoScopedPath(repoRef, `/explore/contributors/${username}`)
    : `/app/explore/contributors/${username}`;
}

export function createColumns(
  repoRef?: string,
  linkContributors = true,
): ColumnDef<ReviewerStats>[] {
  const usernameCell = (username: string) =>
    linkContributors ? (
      createUsernameLink(username, getContributorPath(username, repoRef))
    ) : (
      <span>{username}</span>
    );
  return [
    {
      accessorKey: "reviewer",
      header: (props) => createStandardHeader(props, "Reviewer"),
      cell: ({ row }) => {
        const reviewer = row.getValue("reviewer") as string;
        // Don't hyperlink threshold/ghost row labels
        if (THRESHOLD_LABELS.includes(reviewer)) {
          return <span className="text-gray-400 font-medium">{reviewer}</span>;
        }
        return usernameCell(reviewer);
      },
      size: 140,
      maxSize: 180,
    },
    {
      id: "review_count",
      accessorFn: (row) => row.review_count.value,
      header: (props) => createStandardHeader(props, "Reviews"),
      size: 70,
      cell: ({ row }) => {
        const metric = row.original.review_count;
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
      id: "approval_count",
      accessorFn: (row) => row.approval_count.value,
      header: (props) => createStandardHeader(props, "Approvals"),
      size: 80,
      cell: ({ row }) => {
        const metric = row.original.approval_count;
        return (
          <MetricCenterCell value={metric.value} className={getMetricClass(metric.category)} />
        );
      },
    },
    {
      id: "first_review_count",
      accessorFn: (row) => row.first_review_count.value,
      header: (props) => createCompactHeader(props, "First", "Reviewer"),
      size: 70,
      cell: ({ row }) => {
        const metric = row.original.first_review_count;
        return (
          <MetricCenterCell value={metric.value} className={getMetricClass(metric.category)} />
        );
      },
    },
    {
      id: "avg_time_as_first_reviewer",
      accessorFn: (row) => row.avg_time_as_first_reviewer.value,
      header: (props) => createCompactHeader(props, "Avg Time", "First Reviewer"),
      cell: ({ row }) => {
        const metric = row.original.avg_time_as_first_reviewer;
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
      id: "median_time_as_first_reviewer",
      accessorFn: (row) => row.median_time_as_first_reviewer.value,
      header: (props) => createCompactHeader(props, "Median Time", "First Reviewer"),
      cell: ({ row }) => {
        const metric = row.original.median_time_as_first_reviewer;
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
      id: "avg_comments_per_reviewed_pr",
      accessorFn: (row) => row.avg_comments_per_reviewed_pr.value,
      header: (props) => createCompactHeader(props, "Avg", "Comments/PR"),
      size: 90,
      cell: ({ row }) => {
        const metric = row.original.avg_comments_per_reviewed_pr;
        return (
          <MetricCenterCell value={metric.value} className={getMetricClass(metric.category)} />
        );
      },
    },
    {
      id: "total_non_author_comments",
      accessorFn: (row) => row.total_non_author_comments.value,
      header: (props) => createCompactHeader(props, "Total Comments", "Added"),
      size: 90,
      cell: ({ row }) => {
        const metric = row.original.total_non_author_comments;
        return (
          <MetricCenterCell value={metric.value} className={getMetricClass(metric.category)} />
        );
      },
    },
    {
      id: "median_lines_per_reviewed_pr",
      accessorFn: (row) => row.median_lines_per_reviewed_pr.value,
      header: (props) => createCompactHeader(props, "Median", "Lines/PR"),
      size: 90,
      cell: ({ row }) => {
        const metric = row.original.median_lines_per_reviewed_pr;
        return (
          <MetricCenterCell value={metric.value} className={getMetricClass(metric.category)} />
        );
      },
    },
    {
      id: "total_lines_reviewed",
      accessorFn: (row) => row.total_lines_reviewed.value,
      header: (props) => createCompactHeader(props, "Total Lines", "Reviewed"),
      size: 90,
      cell: ({ row }) => {
        const metric = row.original.total_lines_reviewed;
        return (
          <MetricCenterCell value={metric.value} className={getMetricClass(metric.category)} />
        );
      },
    },
    {
      id: "unique_authors_interacted_with",
      accessorFn: (row) => row.unique_authors_interacted_with.value,
      header: (props) => createCompactHeader(props, "Unique", "Authors"),
      size: 100,
      cell: ({ row }) => {
        const metric = row.original.unique_authors_interacted_with;
        return (
          <MetricCenterCell value={metric.value} className={getMetricClass(metric.category)} />
        );
      },
    },
    {
      accessorKey: "most_interacted_author",
      header: (props) => createCompactHeader(props, "Top Author", "(PRs)"),
      cell: ({ row }) => {
        const author = row.getValue("most_interacted_author") as string;
        if (!author) {
          return <div className="text-center text-base">-</div>;
        }
        return usernameCell(author);
      },
      size: 130,
    },
    {
      accessorKey: "most_interacted_author_by_comments",
      header: (props) => createCompactHeader(props, "Top Author", "(Comments)"),
      cell: ({ row }) => {
        const author = row.getValue("most_interacted_author_by_comments") as string;
        if (!author) {
          return <div className="text-center text-base">-</div>;
        }
        return usernameCell(author);
      },
      size: 130,
    },
  ];
}

export const columns = createColumns();
