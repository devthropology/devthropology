import type { ReviewerStats as ReviewerStatsRow } from "../models/dbTypes.ts";
import type {
  MetricDirection,
  MetricRating,
} from "../../shared/models/metrics.ts";
import type {
  ReviewerStats,
  ReviewerStatsResponse,
} from "../../shared/models/reviewerStats.ts";
import {
  buildMetricRating,
  computeMetricDistribution,
  type MetricDistribution,
  type RatedCategory,
  selectCategoryRepresentativeValue,
} from "./metricStats.ts";

const REVIEWER_METRICS = [
  { key: "active_days", direction: "higher" },
  { key: "review_count", direction: "higher" },
  { key: "first_review_count", direction: "higher" },
  { key: "approval_count", direction: "higher" },
  { key: "total_non_author_comments", direction: "higher" },
  { key: "median_time_as_first_reviewer", direction: "lower" },
  { key: "avg_time_as_first_reviewer", direction: "lower" },
  { key: "unique_authors_interacted_with", direction: "higher" },
  { key: "total_lines_reviewed", direction: "higher" },
  { key: "median_lines_per_reviewed_pr", direction: "higher" },
  { key: "avg_comments_per_reviewed_pr", direction: "higher" },
] as const;

type ReviewerMetricKey = (typeof REVIEWER_METRICS)[number]["key"];

const REVIEWER_METRIC_DIRECTIONS = Object.fromEntries(
  REVIEWER_METRICS.map(({ key, direction }) => [key, direction]),
) as Record<ReviewerMetricKey, MetricDirection>;

type MetricDistributionByMetric = Record<
  ReviewerMetricKey,
  MetricDistribution | null
>;

const emptyDistributionsByMetric = REVIEWER_METRICS.reduce((acc, { key }) => {
  acc[key] = null;
  return acc;
}, {} as MetricDistributionByMetric);

const computeAvgCommentsPerPr = (stat: ReviewerStatsRow): number | null => {
  if (stat.review_count === 0) return null;
  return (
    Math.round((stat.total_non_author_comments / stat.review_count) * 100) / 100
  );
};

const collectMetricValues = (
  stats: ReviewerStatsRow[],
  key: ReviewerMetricKey,
) => {
  if (key === "avg_comments_per_reviewed_pr") {
    return stats
      .map((stat) => computeAvgCommentsPerPr(stat))
      .filter(
        (value) => typeof value === "number" && Number.isFinite(value),
      ) as number[];
  }
  return stats
    .map((stat) => stat[key as keyof ReviewerStatsRow])
    .filter(
      (value) => typeof value === "number" && Number.isFinite(value),
    ) as number[];
};

const buildDistributionsByMetric = (
  stats: ReviewerStatsRow[],
): MetricDistributionByMetric =>
  REVIEWER_METRICS.reduce((acc, { key }) => {
    acc[key] = computeMetricDistribution(collectMetricValues(stats, key));
    return acc;
  }, {} as MetricDistributionByMetric);

const buildReviewerRow = (
  stat: ReviewerStatsRow,
  distributionsByMetric: MetricDistributionByMetric,
): ReviewerStats => ({
  reviewer: stat.reviewer,
  active_days: buildMetricRating(
    stat.active_days,
    distributionsByMetric.active_days,
    REVIEWER_METRIC_DIRECTIONS.active_days,
  ),
  review_count: buildMetricRating(
    stat.review_count,
    distributionsByMetric.review_count,
    REVIEWER_METRIC_DIRECTIONS.review_count,
  ),
  first_review_count: buildMetricRating(
    stat.first_review_count,
    distributionsByMetric.first_review_count,
    REVIEWER_METRIC_DIRECTIONS.first_review_count,
  ),
  approval_count: buildMetricRating(
    stat.approval_count,
    distributionsByMetric.approval_count,
    REVIEWER_METRIC_DIRECTIONS.approval_count,
  ),
  total_non_author_comments: buildMetricRating(
    stat.total_non_author_comments,
    distributionsByMetric.total_non_author_comments,
    REVIEWER_METRIC_DIRECTIONS.total_non_author_comments,
  ),
  median_time_as_first_reviewer: buildMetricRating(
    stat.median_time_as_first_reviewer,
    distributionsByMetric.median_time_as_first_reviewer,
    REVIEWER_METRIC_DIRECTIONS.median_time_as_first_reviewer,
  ),
  avg_time_as_first_reviewer: buildMetricRating(
    stat.avg_time_as_first_reviewer,
    distributionsByMetric.avg_time_as_first_reviewer,
    REVIEWER_METRIC_DIRECTIONS.avg_time_as_first_reviewer,
  ),
  unique_authors_interacted_with: buildMetricRating(
    stat.unique_authors_interacted_with,
    distributionsByMetric.unique_authors_interacted_with,
    REVIEWER_METRIC_DIRECTIONS.unique_authors_interacted_with,
  ),
  most_interacted_author: stat.most_interacted_author,
  most_interacted_author_by_comments: stat.most_interacted_author_by_comments,
  total_lines_reviewed: buildMetricRating(
    stat.total_lines_reviewed,
    distributionsByMetric.total_lines_reviewed,
    REVIEWER_METRIC_DIRECTIONS.total_lines_reviewed,
  ),
  median_lines_per_reviewed_pr: buildMetricRating(
    stat.median_lines_per_reviewed_pr,
    distributionsByMetric.median_lines_per_reviewed_pr,
    REVIEWER_METRIC_DIRECTIONS.median_lines_per_reviewed_pr,
  ),
  avg_comments_per_reviewed_pr: buildMetricRating(
    computeAvgCommentsPerPr(stat),
    distributionsByMetric.avg_comments_per_reviewed_pr,
    REVIEWER_METRIC_DIRECTIONS.avg_comments_per_reviewed_pr,
  ),
});

const THRESHOLD_LEVELS: { label: string; category: RatedCategory }[] = [
  { label: "Top", category: "elite" },
  { label: "High", category: "high" },
  { label: "Middle", category: "average" },
  { label: "Low", category: "low" },
  { label: "Bottom", category: "at-risk" },
];

const buildThresholdMetricRating = (
  metricKey: ReviewerMetricKey,
  distributionsByMetric: MetricDistributionByMetric,
  level: (typeof THRESHOLD_LEVELS)[number],
): MetricRating<number | null> => {
  const distribution = distributionsByMetric[metricKey];
  if (!distribution) {
    return { value: null, category: "unknown" };
  }

  const direction = REVIEWER_METRIC_DIRECTIONS[metricKey];
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
): ReviewerStats => ({
  reviewer: level.label,
  active_days: buildThresholdMetricRating(
    "active_days",
    distributionsByMetric,
    level,
  ),
  review_count: buildThresholdMetricRating(
    "review_count",
    distributionsByMetric,
    level,
  ),
  first_review_count: buildThresholdMetricRating(
    "first_review_count",
    distributionsByMetric,
    level,
  ),
  approval_count: buildThresholdMetricRating(
    "approval_count",
    distributionsByMetric,
    level,
  ),
  total_non_author_comments: buildThresholdMetricRating(
    "total_non_author_comments",
    distributionsByMetric,
    level,
  ),
  median_time_as_first_reviewer: buildThresholdMetricRating(
    "median_time_as_first_reviewer",
    distributionsByMetric,
    level,
  ),
  avg_time_as_first_reviewer: buildThresholdMetricRating(
    "avg_time_as_first_reviewer",
    distributionsByMetric,
    level,
  ),
  unique_authors_interacted_with: buildThresholdMetricRating(
    "unique_authors_interacted_with",
    distributionsByMetric,
    level,
  ),
  most_interacted_author: "",
  most_interacted_author_by_comments: "",
  total_lines_reviewed: buildThresholdMetricRating(
    "total_lines_reviewed",
    distributionsByMetric,
    level,
  ),
  median_lines_per_reviewed_pr: buildThresholdMetricRating(
    "median_lines_per_reviewed_pr",
    distributionsByMetric,
    level,
  ),
  avg_comments_per_reviewed_pr: buildThresholdMetricRating(
    "avg_comments_per_reviewed_pr",
    distributionsByMetric,
    level,
  ),
});

export const buildReviewerStatsResponse = (
  stats: ReviewerStatsRow[],
  options: { includeThresholds?: boolean } = {},
): ReviewerStatsResponse => {
  const includeThresholds = options.includeThresholds ?? true;
  const distributionsByMetric = includeThresholds
    ? buildDistributionsByMetric(stats)
    : emptyDistributionsByMetric;

  return {
    reviewers: stats.map((stat) =>
      buildReviewerRow(stat, distributionsByMetric),
    ),
    thresholds: includeThresholds
      ? THRESHOLD_LEVELS.map((level) =>
          buildThresholdRow(distributionsByMetric, level),
        )
      : [],
  };
};
