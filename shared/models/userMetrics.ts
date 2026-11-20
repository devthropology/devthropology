import { z } from "zod";

export const USER_METRIC_KEYS = {
  PRS_MERGED: "prs_merged",
  LINES_MODIFIED: "lines_modified",
  PRS_REVIEWED: "prs_reviewed",
  PR_COMMENTS_ADDED: "pr_comments_added",
} as const;

export const USER_METRIC_PERIODS = {
  ONE_MONTH: "1mo",
  THREE_MONTHS: "3mo",
  ONE_YEAR: "1yr",
  ALL_TIME: "all",
} as const;

export const UserMetricKeyEnum = z.enum(
  Object.values(USER_METRIC_KEYS) as [string, ...string[]],
);

export const UserMetricPeriodEnum = z.enum(
  Object.values(USER_METRIC_PERIODS) as [string, ...string[]],
);

export const ComputedUserMetricValueSchema = z.object({
  value: z.number(),
  rank: z.number().nullable(),
  rankOutOf: z.number().nullable(),
});

export const ComputedUserMetricsSchema = z.object({
  metrics: z.record(
    UserMetricKeyEnum,
    z.record(UserMetricPeriodEnum, ComputedUserMetricValueSchema),
  ),
});

export type UserMetricKey = z.infer<typeof UserMetricKeyEnum>;
export type UserMetricPeriod = z.infer<typeof UserMetricPeriodEnum>;

export type ComputedUserMetricValue = z.infer<
  typeof ComputedUserMetricValueSchema
>;

export type ComputedUserMetrics = z.infer<typeof ComputedUserMetricsSchema>;
