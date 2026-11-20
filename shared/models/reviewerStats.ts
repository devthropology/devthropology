import { z } from "zod";
import { MetricRatingSchema } from "./metrics.ts";

export const ReviewerStatsSchema = z.object({
  reviewer: z.string(),
  active_days: MetricRatingSchema,
  review_count: MetricRatingSchema,
  first_review_count: MetricRatingSchema,
  approval_count: MetricRatingSchema,
  total_non_author_comments: MetricRatingSchema,
  median_time_as_first_reviewer: MetricRatingSchema,
  avg_time_as_first_reviewer: MetricRatingSchema,
  unique_authors_interacted_with: MetricRatingSchema,
  most_interacted_author: z.string(),
  most_interacted_author_by_comments: z.string(),
  total_lines_reviewed: MetricRatingSchema,
  median_lines_per_reviewed_pr: MetricRatingSchema,
  avg_comments_per_reviewed_pr: MetricRatingSchema,
});
export type ReviewerStats = z.infer<typeof ReviewerStatsSchema>;

export const ReviewerStatsResponseSchema = z.object({
  reviewers: z.array(ReviewerStatsSchema),
  thresholds: z.array(ReviewerStatsSchema),
});
export type ReviewerStatsResponse = z.infer<typeof ReviewerStatsResponseSchema>;
