import { z } from "zod";

export const RepositoryDetailsSchema = z.object({
  repository_id: z.coerce.number(),
  org: z.string(),
  name: z.string(),
  last_sync_at: z.string().nullable().optional(),
});
export type RepositoryDetails = z.infer<typeof RepositoryDetailsSchema>;

export const DbUserSchema = z.object({
  name: z.string(),
});

export const DbIssueSchema = z.object({
  _id: z.number(),
  id: z.number(),
  title: z.string(),
  state: z.string(),
  body: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  closed_at: z.string().nullable(),
});

export const FullIssueSchema = DbIssueSchema.extend({
  user: DbUserSchema,
});
export type FullIssue = z.infer<typeof FullIssueSchema>;

export const DbPullRequestSchema = z.object({
  _pr_id: z.number(),
  merged_at: z.string().nullable(),
  target_branch: z.string(),
  source_branch: z.string(),
  rounds_of_review: z.number(),
  // track changed files and additions/deletions
});

export const DbCommentSchema = z.object({
  body: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  author_association: z.string(),
});
export const DbCommentWithUserSchema = DbCommentSchema.extend({
  user: DbUserSchema,
});

export const DbCommitSchema = z.object({
  message: z.string(),
  committed_at: z.string(),
});
export const DbCommitWithUserSchema = DbCommitSchema.extend({
  user: DbUserSchema,
});

export const DbReviewSchema = z.object({
  body: z.string(),
  state: z.string(),
  submitted_at: z.string().nullable(),
  author_association: z.string(),
});
export const DbReviewWithUserSchema = DbReviewSchema.extend({
  user: DbUserSchema,
});

export const DbFileSchema = z.object({
  filename: z.string(),
  additions: z.number(),
  deletions: z.number(),
  changes: z.number(),
});

export const FullPullRequestSchema = FullIssueSchema.extend({
  ...DbPullRequestSchema.shape,
  reviewComments: z.array(DbCommentWithUserSchema),
  issueComments: z.array(DbCommentWithUserSchema),
  commits: z.array(DbCommitWithUserSchema),
  files: z.array(DbFileSchema),
});
export type FullPullRequest = z.infer<typeof FullPullRequestSchema>;

// PostgreSQL-specific schemas that handle type conversions
export const PostgresIssueWithUserSchema = z.object({
  _id: z.coerce.number(),
  id: z.coerce.number(),
  title: z.string(),
  state: z.string(),
  body: z.string().nullable(),
  created_at: z
    .union([z.string(), z.date()])
    .transform((d) => (d instanceof Date ? d.toISOString() : d)),
  updated_at: z
    .union([z.string(), z.date()])
    .transform((d) => (d instanceof Date ? d.toISOString() : d)),
  closed_at: z
    .union([z.string(), z.date()])
    .transform((d) => (d instanceof Date ? d.toISOString() : d))
    .nullable(),
  user_id: z.coerce.number(),
  name: z.string(),
});

export const PostgresPullRequestSchema = z.object({
  _pr_id: z.coerce.number(),
  merged_at: z
    .union([z.string(), z.date()])
    .transform((d) => (d instanceof Date ? d.toISOString() : d))
    .nullable(),
  target_branch: z.string(),
  source_branch: z.string(),
  rounds_of_review: z.coerce.number(),
  additions: z.coerce.number(),
  deletions: z.coerce.number(),
  changed_files: z.coerce.number(),
  commit_count: z.coerce.number(),
  comment_count: z.coerce.number(),
  review_comment_count: z.coerce.number(),
  merge_commit_sha: z.string().nullable(),
});

export const ReviewerStatsSchema = z.object({
  reviewer: z.string(),
  active_days: z.coerce.number(),
  review_count: z.coerce.number(),
  first_review_count: z.coerce.number(),
  approval_count: z.coerce.number(),
  total_non_author_comments: z.coerce.number(),
  median_time_as_first_reviewer: z.coerce.number().nullable(),
  avg_time_as_first_reviewer: z.coerce.number().nullable(),
  unique_authors_interacted_with: z.coerce.number(),
  most_interacted_author: z.string(),
  most_interacted_author_by_comments: z.string(),
  total_lines_reviewed: z.coerce.number(),
  median_lines_per_reviewed_pr: z.coerce.number().nullable(),
});
export type ReviewerStats = z.infer<typeof ReviewerStatsSchema>;

export const AuthorStatsSchema = z.object({
  author: z.string(),

  // Activity Metrics
  active_days: z.coerce.number(),
  open_prs_count: z.coerce.number(),
  merged_prs_count: z.coerce.number(),
  avg_pr_per_active_day: z.coerce.number(),

  // Time Metrics
  avg_time_to_merge: z.coerce.number(),
  median_time_to_merge: z.coerce.number(),
  avg_time_to_first_review: z.coerce.number().nullable(),
  median_time_to_first_review: z.coerce.number().nullable(),

  // Review Metrics
  avg_rounds_of_review: z.coerce.number(),
  total_comments_merged: z.coerce.number(),
  avg_comments_per_pr: z.coerce.number(),
  median_comments_per_pr: z.coerce.number(),

  // Code Change Metrics
  median_files_changed: z.coerce.number(),
  avg_files_changed: z.coerce.number(),
  median_lines_changed: z.coerce.number(),
  avg_lines_changed: z.coerce.number(),
  total_additions: z.coerce.number(),
  total_deletions: z.coerce.number(),

  // File and Package Metrics
  unique_files_touched_count: z.coerce.number(),
  top_touched_package: z.string().nullable(),
});
export type AuthorStats = z.infer<typeof AuthorStatsSchema>;

// Should we do joins -> join to user table for name, join to issue table for gh id and title
export const UserActivitySchema = z.object({
  user_id: z.coerce.number(),
  first_seen_issue_id: z.coerce.number(),
  first_seen_timestamp: z
    .union([z.string(), z.date()])
    .transform((d) => (d instanceof Date ? d.toISOString() : d)),
  first_seen_activity_type: z.string(),
  last_seen_issue_id: z.coerce.number(),
  last_seen_timestamp: z
    .union([z.string(), z.date()])
    .transform((d) => (d instanceof Date ? d.toISOString() : d)),
  last_seen_activity_type: z.string(),
});
export type UserActivity = z.infer<typeof UserActivitySchema>;

export const UserActivityOverviewSchema = z.object({
  git_repo: z.string(),
  gh_login: z.string(),
  first_seen_timestamp: z.coerce.date(),
  first_seen_issue_id: z.coerce.number(),
  first_seen_activity_type: z.string(),
  first_seen_title: z.string(),
  last_seen_timestamp: z.coerce.date(),
  last_seen_issue_id: z.coerce.number(),
  last_seen_activity_type: z.string(),
  last_seen_title: z.string(),
  prs_merged: z.coerce.number(),
  prs_merged_rank: z.number().nullable(),
  lines_modified: z.coerce.number(),
  lines_modified_rank: z.number().nullable(),
  prs_reviewed: z.coerce.number(),
  prs_reviewed_rank: z.number().nullable(),
  pr_comments: z.coerce.number(),
  pr_comments_rank: z.number().nullable(),
});

export type UserActivityOverview = z.infer<typeof UserActivityOverviewSchema>;

export const MergesByDaySchema = z.object({
  merge_date: z.coerce.date(),
  prs_merged: z.coerce.number(),
  total_lines_changed: z.coerce.number(),
  total_files_changed: z.coerce.number(),
  total_lines_added: z.coerce.number(),
  total_lines_deleted: z.coerce.number(),
  files_added: z.coerce.number(),
  files_modified: z.coerce.number(),
  files_removed: z.coerce.number(),
  files_renamed: z.coerce.number(),
  contributor_ages: z.array(z.coerce.number()).optional().default([]),
});

export type MergesByDay = z.infer<typeof MergesByDaySchema>;

export const RecentPullSchema = z.object({
  gh_issue_id: z.coerce.number(),
  title: z.string(),
  status: z.enum(["open", "closed", "merged"]),
  created_at: z.coerce.date(),
  closed_at: z.coerce.date().nullable(),
  additions: z.coerce.number().nullable().optional(),
  deletions: z.coerce.number().nullable().optional(),
  changed_files: z.coerce.number().nullable().optional(),
  rounds_of_review: z.coerce.number().nullable().optional(),
  bot_rounds_of_review: z.coerce.number().nullable().optional(),
  author_comments: z.coerce.number().nullable().optional(),
  non_author_comments: z.coerce.number().nullable().optional(),
  bot_comments: z.coerce.number().nullable().optional(),
  first_review_time: z.coerce.date().nullable().optional(),
  first_approval_time: z.coerce.date().nullable().optional(),
});
export type RecentPull = z.infer<typeof RecentPullSchema>;

export const UserStatsForUiSchema = z.object({
  issue_count: z.coerce.number(),
  pull_request_count: z.coerce.number(),
  merged_pull_count: z.coerce.number(),
  open_pull_count: z.coerce.number(),
  repo_owner: z.string(),
  repo_name: z.string(),
  first_seen_timestamp: z.coerce.date().nullable(),
  last_seen_timestamp: z.coerce.date().nullable(),
  user_position: z.coerce.number(),
  total_unique_users: z.coerce.number(),
});
export type UserStatsForUi = z.infer<typeof UserStatsForUiSchema>;

export const UserPullStatsDbSchema = z.object({
  recent_pulls: z.array(RecentPullSchema),
  repo_owner: z.string(),
  repo_name: z.string(),
});
export type UserPullStatsDb = z.infer<typeof UserPullStatsDbSchema>;

export const RecentIssueReviewSchema = z.object({
  gh_issue_id: z.coerce.number(),
  title: z.string(),
  author_login: z.string(),
  created_at: z.coerce.date(),
  status: z.enum(["Merged", "Closed", "Open"]),
  additions: z.coerce.number().nullable().optional(),
  deletions: z.coerce.number().nullable().optional(),
  changed_files: z.coerce.number().nullable().optional(),
  rounds_of_review: z.coerce.number().nullable().optional(),
  review_status: z.enum([
    "approved",
    "requested_changes",
    "dismissed",
    "commented",
  ]),
  was_first_reviewer: z.boolean().nullable(),
  time_to_first_review: z.coerce.number().nullable(), // Time in hours as number (coerced from PostgreSQL string)
  author_comments: z.coerce.number(),
  reviewer_comments: z.coerce.number(),
  other_user_comments: z.coerce.number(),
  bot_comments: z.coerce.number(),
});
export type RecentIssueReview = z.infer<typeof RecentIssueReviewSchema>;

export const UserIssueStatsSchema = z.object({
  recent_issue_reviews: z.array(RecentIssueReviewSchema),
  repo_owner: z.string(),
  repo_name: z.string(),
});
export type UserIssueStats = z.infer<typeof UserIssueStatsSchema>;

export const RenamedFileForBackfillSchema = z.object({
  gh_login: z.string(),
  title: z.string(),
  created_at: z.coerce.date(),
  gh_issue_id: z.coerce.number(),
  pull_request_file_id: z.coerce.number(),
  filename: z.string(),
  status: z.string(),
});
export type RenamedFileForBackfill = z.infer<
  typeof RenamedFileForBackfillSchema
>;

export const FileSystemActivitySchema = z.object({
  // From user table
  user_id: z.coerce.number(),
  gh_login: z.string(),

  // From pull_request_file table (prf.*)
  pull_request_file_id: z.coerce.number(),
  pull_request_id: z.coerce.number(),
  filename: z.string(),
  status: z.string(),
  additions: z.coerce.number(),
  deletions: z.coerce.number(),
  changes: z.coerce.number(),
  previous_filename: z.string().nullable(),
  inserted_at: z
    .union([z.string(), z.date()])
    .transform((d) => (d instanceof Date ? d.toISOString() : d)),

  // From pull_request table
  merged_at: z
    .union([z.string(), z.date()])
    .transform((d) => (d instanceof Date ? d.toISOString() : d))
    .nullable(),
  source_branch: z.string(),
  target_branch: z.string(),

  // From issue table
  gh_issue_id: z.coerce.number(),
  title: z.string(),
});
export type FileSystemActivity = z.infer<typeof FileSystemActivitySchema>;

export const PrTimingSchema = z.object({
  created_at: z.coerce.date(),
  merged_at: z.coerce.date(),
  hours_to_merge: z.coerce.number(),
});
export type PrTiming = z.infer<typeof PrTimingSchema>;

export const ComputedRepositoryOverviewSchema = z.object({
  repository_id: z.coerce.number(),
  first_activity: z
    .union([z.string(), z.date()])
    .transform((d) => (d instanceof Date ? d.toISOString() : d))
    .nullable(),
  last_activity: z
    .union([z.string(), z.date()])
    .transform((d) => (d instanceof Date ? d.toISOString() : d))
    .nullable(),
  total_users: z.coerce.number(),
  active_users_3mo: z.coerce.number(),
  merged_prs: z.coerce.number(),
  open_prs: z.coerce.number(),
  closed_prs: z.coerce.number(),
  total_prs: z.coerce.number(),
  estimated_total_files: z.coerce.number(),
  estimated_total_loc: z.coerce.number(),
  top_file_types_by_count: z
    .array(
      z.object({
        extension: z.string(),
        count: z.number(),
      }),
    )
    .nullable(),
  top_file_types_by_loc: z
    .array(
      z.object({
        extension: z.string(),
        loc: z.number(),
      }),
    )
    .nullable(),
  median_author_age_3mo_days: z.coerce.number().nullable(),
  computed_at: z
    .union([z.string(), z.date()])
    .transform((d) => (d instanceof Date ? d.toISOString() : d)),
});
export type ComputedRepositoryOverview = z.infer<
  typeof ComputedRepositoryOverviewSchema
>;

export const ComputedTrendsMonthlySchema = z.object({
  repository_id: z.coerce.number(),
  year: z.coerce.number().int(),
  month: z.coerce.number().int().min(1).max(12),
  merged_prs: z.coerce.number().int().nullable(),
  avg_pr_size: z.coerce.number().nullable(),
  p50_pr_size: z.coerce.number().nullable(),
  p75_pr_size: z.coerce.number().nullable(),
  p90_pr_size: z.coerce.number().nullable(),
  active_authors: z.coerce.number().int().nullable(),
  avg_merged_prs_per_author: z.coerce.number().nullable(),
  p50_merged_prs_per_author: z.coerce.number().nullable(),
  p75_merged_prs_per_author: z.coerce.number().nullable(),
  p90_merged_prs_per_author: z.coerce.number().nullable(),
  avg_lines_changed_per_author: z.coerce.number().nullable(),
  p50_lines_changed_per_author: z.coerce.number().nullable(),
  p75_lines_changed_per_author: z.coerce.number().nullable(),
  p90_lines_changed_per_author: z.coerce.number().nullable(),
  avg_rounds: z.coerce.number().nullable(),
  avg_all_rounds: z.coerce.number().nullable(),
  p50_rounds: z.coerce.number().nullable(),
  p75_rounds: z.coerce.number().nullable(),
  p90_rounds: z.coerce.number().nullable(),
  p95_rounds: z.coerce.number().nullable(),
  p99_rounds: z.coerce.number().nullable(),
  pct_zero_rounds: z.coerce.number().nullable(),
  pct_one_round: z.coerce.number().nullable(),
  pct_two_rounds: z.coerce.number().nullable(),
  pct_three_plus_rounds: z.coerce.number().nullable(),
  pct_any_round: z.coerce.number().nullable(),
  pct_two_plus_rounds: z.coerce.number().nullable(),
  pct_any_all_rounds: z.coerce.number().nullable(),
  pct_two_plus_all_rounds: z.coerce.number().nullable(),
  p50_time_to_first_review_hours: z.coerce.number().nullable(),
  p75_time_to_first_review_hours: z.coerce.number().nullable(),
  p90_time_to_first_review_hours: z.coerce.number().nullable(),
  p50_time_to_effective_approval_hours: z.coerce.number().nullable(),
  p75_time_to_effective_approval_hours: z.coerce.number().nullable(),
  p90_time_to_effective_approval_hours: z.coerce.number().nullable(),
  computed_at: z
    .union([z.string(), z.date()])
    .transform((d) => (d instanceof Date ? d.toISOString() : d)),
});

export type ComputedTrendsMonthly = z.infer<typeof ComputedTrendsMonthlySchema>;

export const ComputedTrendsMonthlySizeBucketSchema = z.object({
  repository_id: z.coerce.number(),
  year: z.coerce.number().int(),
  month: z.coerce.number().int().min(1).max(12),
  size_bucket: z.string(),
  prs: z.coerce.number().int().nullable(),
  pct_of_month_prs: z.coerce.number().nullable(),
  avg_rounds: z.coerce.number().nullable(),
  avg_all_rounds: z.coerce.number().nullable(),
  pct_zero_rounds: z.coerce.number().nullable(),
  pct_any_round: z.coerce.number().nullable(),
  p50_time_to_first_review_hours: z.coerce.number().nullable(),
  p75_time_to_first_review_hours: z.coerce.number().nullable(),
  p90_time_to_first_review_hours: z.coerce.number().nullable(),
  p50_time_to_effective_approval_hours: z.coerce.number().nullable(),
  p75_time_to_effective_approval_hours: z.coerce.number().nullable(),
  p90_time_to_effective_approval_hours: z.coerce.number().nullable(),
  computed_at: z
    .union([z.string(), z.date()])
    .transform((d) => (d instanceof Date ? d.toISOString() : d)),
});

export type ComputedTrendsMonthlySizeBucket = z.infer<
  typeof ComputedTrendsMonthlySizeBucketSchema
>;

export const ComputedTrendsMonthlyAiModelSchema = z.object({
  repository_id: z.coerce.number(),
  year: z.coerce.number().int(),
  month: z.coerce.number().int().min(1).max(12),
  model: z.string(),
  merged_prs: z.coerce.number().int().nullable(),
  ai_assisted_prs: z.coerce.number().int().nullable(),
  pct_ai_assisted_prs: z.coerce.number().nullable(),
  computed_at: z
    .union([z.string(), z.date()])
    .transform((d) => (d instanceof Date ? d.toISOString() : d)),
});

export type ComputedTrendsMonthlyAiModel = z.infer<
  typeof ComputedTrendsMonthlyAiModelSchema
>;

// Database model for computed filesystem nodes - stores FileSystemNode data
export const ComputedFileSystemNodeSchema = z.object({
  repository_id: z.number(),
  path: z.string(),
  parent_path: z.string().nullable(),
  level: z.number(),
  node_data: z.preprocess(
    (data) => {
      // PostgreSQL returns JSONB as strings in some contexts, parse if needed
      if (typeof data === "string") {
        try {
          return JSON.parse(data);
        } catch {
          return data;
        }
      }
      return data;
    },
    z.any(), // Stores the complete FileSystemNode object
  ),
});

export type ComputedFileSystemNode = z.infer<
  typeof ComputedFileSystemNodeSchema
>;
