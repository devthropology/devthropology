import { z } from "zod";
import { MetricRatingSchema } from "./metrics.ts";

export const AuthorStatsSchema = z.object({
  author: z.string(),
  active_days: MetricRatingSchema,
  open_prs_count: MetricRatingSchema,
  merged_prs_count: MetricRatingSchema,
  avg_pr_per_active_day: MetricRatingSchema,
  avg_time_to_merge: MetricRatingSchema,
  median_time_to_merge: MetricRatingSchema,
  avg_time_to_first_review: MetricRatingSchema,
  median_time_to_first_review: MetricRatingSchema,
  avg_rounds_of_review: MetricRatingSchema,
  total_comments_merged: MetricRatingSchema,
  avg_comments_per_pr: MetricRatingSchema,
  median_comments_per_pr: MetricRatingSchema,
  median_files_changed: MetricRatingSchema,
  avg_files_changed: MetricRatingSchema,
  median_lines_changed: MetricRatingSchema,
  avg_lines_changed: MetricRatingSchema,
  total_additions: MetricRatingSchema,
  total_deletions: MetricRatingSchema,
  unique_files_touched_count: MetricRatingSchema,
  top_touched_package: z.string().nullable(),
});
export type AuthorStats = z.infer<typeof AuthorStatsSchema>;

export const AuthorStatsResponseSchema = z.object({
  authors: z.array(AuthorStatsSchema),
  thresholds: z.array(AuthorStatsSchema),
});
export type AuthorStatsResponse = z.infer<typeof AuthorStatsResponseSchema>;
