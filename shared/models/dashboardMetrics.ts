import { z } from "zod";

// Weekly data point for trends (Monday-based weeks)
export const WeeklyVolumeSchema = z.object({
  weekStartDate: z.string(), // ISO date string for Monday of the week (e.g., "2025-07-21")
  prsMerged: z.number(),
  linesAdded: z.number(),
  linesDeleted: z.number(),
  filesChanged: z.number(),
  filesAdded: z.number(),
  filesModified: z.number(),
  filesRemoved: z.number(),
  filesRenamed: z.number(),
  ageBuckets: z
    .array(
      z.object({
        key: z.string(),
        title: z.string(),
        range: z.string(),
        count: z.number(),
      }),
    )
    .optional()
    .default([]),
  avgContributorAgeDays: z.number().nullable(),
  medianContributorAgeDays: z.number().nullable(),
  avgTimeToMergeHours: z.number().nullable(), // null if no PRs merged that week
  medianTimeToMergeHours: z.number().nullable(), // null if no PRs merged that week
});
export type WeeklyVolume = z.infer<typeof WeeklyVolumeSchema>;

// Volume snapshot for current/prior periods with percentage changes
export const VolumeSnapshotSchema = z.object({
  prsMerged: z.number(),
  prsMergedChangePercent: z.number().nullable(), // null for baseline periods, % change for current periods
  linesAdded: z.number(),
  linesAddedChangePercent: z.number().nullable(),
  linesDeleted: z.number(),
  linesDeletedChangePercent: z.number().nullable(),
  filesChanged: z.number(),
  filesChangedChangePercent: z.number().nullable(),
  filesAdded: z.number(),
  filesModified: z.number(),
  filesRemoved: z.number(),
  filesRenamed: z.number(),
  avgContributorAgeDays: z.number().nullable(),
  avgContributorAgeDaysChangePercent: z.number().nullable(),
  medianContributorAgeDays: z.number().nullable(),
  medianContributorAgeDaysChangePercent: z.number().nullable(),
  avgTimeToMergeHours: z.number().nullable(), // null if no PRs merged in period
  avgTimeToMergeHoursChangePercent: z.number().nullable(),
  medianTimeToMergeHours: z.number().nullable(), // null if no PRs merged in period
  medianTimeToMergeHoursChangePercent: z.number().nullable(),
});
export type VolumeSnapshot = z.infer<typeof VolumeSnapshotSchema>;

// Volume metrics with current/prior comparisons and weekly trends
export const VolumeMetricsSchema = z.object({
  current7d: VolumeSnapshotSchema,
  prior7d: VolumeSnapshotSchema,
  current30d: VolumeSnapshotSchema,
  prior30d: VolumeSnapshotSchema,
  weeklyTrends: z.array(WeeklyVolumeSchema), // Last 26 weeks (6 months)
});
export type VolumeMetrics = z.infer<typeof VolumeMetricsSchema>;

export const ContributorAgeBucketSchema = z.object({
  key: z.string(), // e.g., "new"
  title: z.string(),
  range: z.string(),
  count: z.number(),
});
export type ContributorAgeBucket = z.infer<typeof ContributorAgeBucketSchema>;

// Main dashboard data response (starting simple, expandable)
export const DashboardDataSchema = z.object({
  volumeMetrics: VolumeMetricsSchema,
  contributorAgeBuckets: z.array(ContributorAgeBucketSchema),
});
export type DashboardData = z.infer<typeof DashboardDataSchema>;
