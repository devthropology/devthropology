import type { AuthorStats as AuthorStatsRow } from "../models/dbTypes.ts";
import type {
  MetricDirection,
  MetricRating,
} from "../../shared/models/metrics.ts";
import type {
  AuthorStats,
  AuthorStatsResponse,
} from "../../shared/models/authorStats.ts";
import {
  buildMetricRating,
  computeMetricDistribution,
  type MetricDistribution,
  type RatedCategory,
  selectCategoryRepresentativeValue,
} from "./metricStats.ts";

const AUTHOR_METRICS = [
  { key: "active_days", direction: "higher" },
  { key: "open_prs_count", direction: "higher" },
  { key: "merged_prs_count", direction: "higher" },
  { key: "avg_pr_per_active_day", direction: "higher" },
  { key: "avg_time_to_merge", direction: "lower" },
  { key: "median_time_to_merge", direction: "lower" },
  { key: "avg_time_to_first_review", direction: "lower" },
  { key: "median_time_to_first_review", direction: "lower" },
  { key: "avg_rounds_of_review", direction: "lower" },
  { key: "total_comments_merged", direction: "higher" },
  { key: "avg_comments_per_pr", direction: "lower" },
  { key: "median_comments_per_pr", direction: "lower" },
  { key: "median_files_changed", direction: "higher" },
  { key: "avg_files_changed", direction: "higher" },
  { key: "median_lines_changed", direction: "higher" },
  { key: "avg_lines_changed", direction: "higher" },
  { key: "total_additions", direction: "higher" },
  { key: "total_deletions", direction: "higher" },
  { key: "unique_files_touched_count", direction: "higher" },
] as const;

type AuthorMetricKey = (typeof AUTHOR_METRICS)[number]["key"];

const AUTHOR_METRIC_DIRECTIONS = Object.fromEntries(
  AUTHOR_METRICS.map(({ key, direction }) => [key, direction]),
) as Record<AuthorMetricKey, MetricDirection>;

type MetricDistributionByMetric = Record<
  AuthorMetricKey,
  MetricDistribution | null
>;

const emptyDistributionsByMetric = AUTHOR_METRICS.reduce((acc, { key }) => {
  acc[key] = null;
  return acc;
}, {} as MetricDistributionByMetric);

const collectMetricValues = (stats: AuthorStatsRow[], key: AuthorMetricKey) =>
  stats
    .map((stat) => stat[key])
    .filter(
      (value) => typeof value === "number" && Number.isFinite(value),
    ) as number[];

const buildDistributionsByMetric = (
  stats: AuthorStatsRow[],
): MetricDistributionByMetric =>
  AUTHOR_METRICS.reduce((acc, { key }) => {
    acc[key] = computeMetricDistribution(collectMetricValues(stats, key));
    return acc;
  }, {} as MetricDistributionByMetric);

const buildAuthorRow = (
  stat: AuthorStatsRow,
  distributionsByMetric: MetricDistributionByMetric,
): AuthorStats => ({
  author: stat.author,
  active_days: buildMetricRating(
    stat.active_days,
    distributionsByMetric.active_days,
    AUTHOR_METRIC_DIRECTIONS.active_days,
  ),
  open_prs_count: buildMetricRating(
    stat.open_prs_count,
    distributionsByMetric.open_prs_count,
    AUTHOR_METRIC_DIRECTIONS.open_prs_count,
  ),
  merged_prs_count: buildMetricRating(
    stat.merged_prs_count,
    distributionsByMetric.merged_prs_count,
    AUTHOR_METRIC_DIRECTIONS.merged_prs_count,
  ),
  avg_pr_per_active_day: buildMetricRating(
    stat.avg_pr_per_active_day,
    distributionsByMetric.avg_pr_per_active_day,
    AUTHOR_METRIC_DIRECTIONS.avg_pr_per_active_day,
  ),
  avg_time_to_merge: buildMetricRating(
    stat.avg_time_to_merge,
    distributionsByMetric.avg_time_to_merge,
    AUTHOR_METRIC_DIRECTIONS.avg_time_to_merge,
  ),
  median_time_to_merge: buildMetricRating(
    stat.median_time_to_merge,
    distributionsByMetric.median_time_to_merge,
    AUTHOR_METRIC_DIRECTIONS.median_time_to_merge,
  ),
  avg_time_to_first_review: buildMetricRating(
    stat.avg_time_to_first_review,
    distributionsByMetric.avg_time_to_first_review,
    AUTHOR_METRIC_DIRECTIONS.avg_time_to_first_review,
  ),
  median_time_to_first_review: buildMetricRating(
    stat.median_time_to_first_review,
    distributionsByMetric.median_time_to_first_review,
    AUTHOR_METRIC_DIRECTIONS.median_time_to_first_review,
  ),
  avg_rounds_of_review: buildMetricRating(
    stat.avg_rounds_of_review,
    distributionsByMetric.avg_rounds_of_review,
    AUTHOR_METRIC_DIRECTIONS.avg_rounds_of_review,
  ),
  total_comments_merged: buildMetricRating(
    stat.total_comments_merged,
    distributionsByMetric.total_comments_merged,
    AUTHOR_METRIC_DIRECTIONS.total_comments_merged,
  ),
  avg_comments_per_pr: buildMetricRating(
    stat.avg_comments_per_pr,
    distributionsByMetric.avg_comments_per_pr,
    AUTHOR_METRIC_DIRECTIONS.avg_comments_per_pr,
  ),
  median_comments_per_pr: buildMetricRating(
    stat.median_comments_per_pr,
    distributionsByMetric.median_comments_per_pr,
    AUTHOR_METRIC_DIRECTIONS.median_comments_per_pr,
  ),
  median_files_changed: buildMetricRating(
    stat.median_files_changed,
    distributionsByMetric.median_files_changed,
    AUTHOR_METRIC_DIRECTIONS.median_files_changed,
  ),
  avg_files_changed: buildMetricRating(
    stat.avg_files_changed,
    distributionsByMetric.avg_files_changed,
    AUTHOR_METRIC_DIRECTIONS.avg_files_changed,
  ),
  median_lines_changed: buildMetricRating(
    stat.median_lines_changed,
    distributionsByMetric.median_lines_changed,
    AUTHOR_METRIC_DIRECTIONS.median_lines_changed,
  ),
  avg_lines_changed: buildMetricRating(
    stat.avg_lines_changed,
    distributionsByMetric.avg_lines_changed,
    AUTHOR_METRIC_DIRECTIONS.avg_lines_changed,
  ),
  total_additions: buildMetricRating(
    stat.total_additions,
    distributionsByMetric.total_additions,
    AUTHOR_METRIC_DIRECTIONS.total_additions,
  ),
  total_deletions: buildMetricRating(
    stat.total_deletions,
    distributionsByMetric.total_deletions,
    AUTHOR_METRIC_DIRECTIONS.total_deletions,
  ),
  unique_files_touched_count: buildMetricRating(
    stat.unique_files_touched_count,
    distributionsByMetric.unique_files_touched_count,
    AUTHOR_METRIC_DIRECTIONS.unique_files_touched_count,
  ),
  top_touched_package: stat.top_touched_package,
});

const THRESHOLD_LEVELS: { label: string; category: RatedCategory }[] = [
  { label: "Top", category: "elite" },
  { label: "High", category: "high" },
  { label: "Middle", category: "average" },
  { label: "Low", category: "low" },
  { label: "Bottom", category: "at-risk" },
];

const buildThresholdMetricRating = (
  metricKey: AuthorMetricKey,
  distributionsByMetric: MetricDistributionByMetric,
  level: (typeof THRESHOLD_LEVELS)[number],
): MetricRating<number | null> => {
  const distribution = distributionsByMetric[metricKey];
  if (!distribution) {
    return { value: null, category: "unknown" };
  }

  const direction = AUTHOR_METRIC_DIRECTIONS[metricKey];
  const value = selectCategoryRepresentativeValue(
    distribution,
    direction,
    level.category,
  );
  const roundedValue = Math.round(value * 10) / 10;
  return { value: roundedValue, category: level.category };
};

const buildThresholdRow = (
  distributionsByMetric: MetricDistributionByMetric,
  level: (typeof THRESHOLD_LEVELS)[number],
): AuthorStats => ({
  author: level.label,
  active_days: buildThresholdMetricRating(
    "active_days",
    distributionsByMetric,
    level,
  ),
  open_prs_count: buildThresholdMetricRating(
    "open_prs_count",
    distributionsByMetric,
    level,
  ),
  merged_prs_count: buildThresholdMetricRating(
    "merged_prs_count",
    distributionsByMetric,
    level,
  ),
  avg_pr_per_active_day: buildThresholdMetricRating(
    "avg_pr_per_active_day",
    distributionsByMetric,
    level,
  ),
  avg_time_to_merge: buildThresholdMetricRating(
    "avg_time_to_merge",
    distributionsByMetric,
    level,
  ),
  median_time_to_merge: buildThresholdMetricRating(
    "median_time_to_merge",
    distributionsByMetric,
    level,
  ),
  avg_time_to_first_review: buildThresholdMetricRating(
    "avg_time_to_first_review",
    distributionsByMetric,
    level,
  ),
  median_time_to_first_review: buildThresholdMetricRating(
    "median_time_to_first_review",
    distributionsByMetric,
    level,
  ),
  avg_rounds_of_review: buildThresholdMetricRating(
    "avg_rounds_of_review",
    distributionsByMetric,
    level,
  ),
  total_comments_merged: buildThresholdMetricRating(
    "total_comments_merged",
    distributionsByMetric,
    level,
  ),
  avg_comments_per_pr: buildThresholdMetricRating(
    "avg_comments_per_pr",
    distributionsByMetric,
    level,
  ),
  median_comments_per_pr: buildThresholdMetricRating(
    "median_comments_per_pr",
    distributionsByMetric,
    level,
  ),
  median_files_changed: buildThresholdMetricRating(
    "median_files_changed",
    distributionsByMetric,
    level,
  ),
  avg_files_changed: buildThresholdMetricRating(
    "avg_files_changed",
    distributionsByMetric,
    level,
  ),
  median_lines_changed: buildThresholdMetricRating(
    "median_lines_changed",
    distributionsByMetric,
    level,
  ),
  avg_lines_changed: buildThresholdMetricRating(
    "avg_lines_changed",
    distributionsByMetric,
    level,
  ),
  total_additions: buildThresholdMetricRating(
    "total_additions",
    distributionsByMetric,
    level,
  ),
  total_deletions: buildThresholdMetricRating(
    "total_deletions",
    distributionsByMetric,
    level,
  ),
  unique_files_touched_count: buildThresholdMetricRating(
    "unique_files_touched_count",
    distributionsByMetric,
    level,
  ),
  top_touched_package: null,
});

export const buildAuthorStatsResponse = (
  stats: AuthorStatsRow[],
  options: { includeThresholds?: boolean } = {},
): AuthorStatsResponse => {
  const includeThresholds = options.includeThresholds ?? true;
  const distributionsByMetric = includeThresholds
    ? buildDistributionsByMetric(stats)
    : emptyDistributionsByMetric;

  return {
    authors: stats.map((stat) => buildAuthorRow(stat, distributionsByMetric)),
    thresholds: includeThresholds
      ? THRESHOLD_LEVELS.map((level) =>
          buildThresholdRow(distributionsByMetric, level),
        )
      : [],
  };
};
