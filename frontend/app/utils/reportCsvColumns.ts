import type { AuthorStats } from "../../../shared/models/authorStats";
import type { ReviewerStats } from "../../../shared/models/reviewerStats";
import type { CsvColumn } from "./csvExport";

// Raw values only: time metrics are exported as decimal hours so they stay
// numeric in a spreadsheet instead of display strings like "1.3 hours".
export const AUTHOR_CSV_COLUMNS: CsvColumn<AuthorStats>[] = [
  { header: "Author", value: (row) => row.author },
  { header: "Merged PRs", value: (row) => row.merged_prs_count.value },
  { header: "Active Days", value: (row) => row.active_days.value },
  {
    header: "Merged PRs per Active Day",
    value: (row) => row.avg_pr_per_active_day.value,
  },
  { header: "PRs Created", value: (row) => row.open_prs_count.value },
  {
    header: "Avg Review Rounds",
    value: (row) => row.avg_rounds_of_review.value,
  },
  {
    header: "Avg Time to First Review (hours)",
    value: (row) => row.avg_time_to_first_review.value,
  },
  {
    header: "Median Time to First Review (hours)",
    value: (row) => row.median_time_to_first_review.value,
  },
  {
    header: "Avg Time to Merge (hours)",
    value: (row) => row.avg_time_to_merge.value,
  },
  {
    header: "Median Time to Merge (hours)",
    value: (row) => row.median_time_to_merge.value,
  },
  {
    header: "Avg Comments per PR",
    value: (row) => row.avg_comments_per_pr.value,
  },
  {
    header: "Median Comments per PR",
    value: (row) => row.median_comments_per_pr.value,
  },
  {
    header: "Total Comments Received",
    value: (row) => row.total_comments_merged.value,
  },
  { header: "Avg Files per PR", value: (row) => row.avg_files_changed.value },
  {
    header: "Median Files per PR",
    value: (row) => row.median_files_changed.value,
  },
  { header: "Avg Lines per PR", value: (row) => row.avg_lines_changed.value },
  {
    header: "Median Lines per PR",
    value: (row) => row.median_lines_changed.value,
  },
  {
    header: "Total Lines Changed",
    value: (row) => {
      const additions = row.total_additions.value;
      const deletions = row.total_deletions.value;
      return additions == null || deletions == null ? null : additions + deletions;
    },
  },
  { header: "Total Additions", value: (row) => row.total_additions.value },
  { header: "Total Deletions", value: (row) => row.total_deletions.value },
  {
    header: "Unique Files Changed",
    value: (row) => row.unique_files_touched_count.value,
  },
  { header: "Top Touched Package", value: (row) => row.top_touched_package },
];

export const REVIEWER_CSV_COLUMNS: CsvColumn<ReviewerStats>[] = [
  { header: "Reviewer", value: (row) => row.reviewer },
  { header: "Reviews", value: (row) => row.review_count.value },
  { header: "Active Days", value: (row) => row.active_days.value },
  { header: "Approvals", value: (row) => row.approval_count.value },
  {
    header: "First Reviewer Count",
    value: (row) => row.first_review_count.value,
  },
  {
    header: "Avg Time as First Reviewer (hours)",
    value: (row) => row.avg_time_as_first_reviewer.value,
  },
  {
    header: "Median Time as First Reviewer (hours)",
    value: (row) => row.median_time_as_first_reviewer.value,
  },
  {
    header: "Avg Comments per PR",
    value: (row) => row.avg_comments_per_reviewed_pr.value,
  },
  {
    header: "Total Comments Added",
    value: (row) => row.total_non_author_comments.value,
  },
  {
    header: "Median Lines per PR",
    value: (row) => row.median_lines_per_reviewed_pr.value,
  },
  {
    header: "Total Lines Reviewed",
    value: (row) => row.total_lines_reviewed.value,
  },
  {
    header: "Unique Authors",
    value: (row) => row.unique_authors_interacted_with.value,
  },
  { header: "Top Author (PRs)", value: (row) => row.most_interacted_author },
  {
    header: "Top Author (Comments)",
    value: (row) => row.most_interacted_author_by_comments,
  },
];
