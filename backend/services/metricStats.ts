import type {
  MetricCategory,
  MetricDirection,
  MetricPercentiles,
  MetricRating,
} from "../../shared/models/metrics.ts";

export const DEFAULT_PERCENTILES = {
  p10: 0.1,
  p25: 0.25,
  p50: 0.5,
  p75: 0.75,
  p90: 0.9,
} as const;

export type PercentileKey = keyof typeof DEFAULT_PERCENTILES;

export type MetricDistribution = MetricPercentiles & {
  min: number;
  max: number;
};

export type BoundKey = "min" | "max" | PercentileKey;

export type RatedCategory = Exclude<MetricCategory, "unknown">;

export type CategoryBounds = Record<
  RatedCategory,
  { lower: BoundKey; upper: BoundKey }
>;

export type CategoryBoundsByDirection = Record<MetricDirection, CategoryBounds>;

export const DEFAULT_CATEGORY_ORDER: RatedCategory[] = [
  "elite",
  "high",
  "average",
  "low",
  "at-risk",
];

export const DEFAULT_CATEGORY_BOUNDS_BY_DIRECTION: CategoryBoundsByDirection = {
  higher: {
    elite: { lower: "p90", upper: "max" },
    high: { lower: "p75", upper: "p90" },
    average: { lower: "p25", upper: "p75" },
    low: { lower: "p10", upper: "p25" },
    "at-risk": { lower: "min", upper: "p10" },
  },
  lower: {
    elite: { lower: "min", upper: "p10" },
    high: { lower: "p10", upper: "p25" },
    average: { lower: "p25", upper: "p75" },
    low: { lower: "p75", upper: "p90" },
    "at-risk": { lower: "p90", upper: "max" },
  },
};

const assertPercentile = (value: number, label: string) => {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(
      `Percentile ${label} must be a finite number between 0 and 1`,
    );
  }
};

const percentileFromSorted = (sorted: number[], percentile: number) => {
  const pos = (sorted.length - 1) * percentile;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
};

export const computeMetricDistribution = (
  values: number[],
  percentiles: typeof DEFAULT_PERCENTILES = DEFAULT_PERCENTILES,
): MetricDistribution | null => {
  const clean = values.filter(
    (value) => typeof value === "number" && Number.isFinite(value),
  );
  if (clean.length === 0) {
    return null;
  }

  assertPercentile(percentiles.p10, "p10");
  assertPercentile(percentiles.p25, "p25");
  assertPercentile(percentiles.p50, "p50");
  assertPercentile(percentiles.p75, "p75");
  assertPercentile(percentiles.p90, "p90");

  const sorted = clean.slice().sort((a, b) => a - b);

  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p10: percentileFromSorted(sorted, percentiles.p10),
    p25: percentileFromSorted(sorted, percentiles.p25),
    p50: percentileFromSorted(sorted, percentiles.p50),
    p75: percentileFromSorted(sorted, percentiles.p75),
    p90: percentileFromSorted(sorted, percentiles.p90),
  };
};

export const categorizeValue = (
  value: number,
  distribution: MetricDistribution,
  direction: MetricDirection,
  boundsByDirection: CategoryBoundsByDirection = DEFAULT_CATEGORY_BOUNDS_BY_DIRECTION,
  order: RatedCategory[] = DEFAULT_CATEGORY_ORDER,
): MetricCategory => {
  const bounds = boundsByDirection[direction];
  for (const category of order) {
    const { lower, upper } = bounds[category];
    if (value >= distribution[lower] && value <= distribution[upper]) {
      return category;
    }
  }

  return "unknown";
};

export const buildMetricRating = <T extends number | null>(
  value: T,
  distribution: MetricDistribution | null,
  direction: MetricDirection,
  boundsByDirection: CategoryBoundsByDirection = DEFAULT_CATEGORY_BOUNDS_BY_DIRECTION,
  order: RatedCategory[] = DEFAULT_CATEGORY_ORDER,
): MetricRating<T> => {
  if (
    value === null ||
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !distribution
  ) {
    return { value, category: "unknown" };
  }

  return {
    value,
    category: categorizeValue(
      value,
      distribution,
      direction,
      boundsByDirection,
      order,
    ),
  };
};

export const selectCategoryRepresentativeValue = (
  distribution: MetricDistribution,
  direction: MetricDirection,
  category: RatedCategory,
  boundsByDirection: CategoryBoundsByDirection = DEFAULT_CATEGORY_BOUNDS_BY_DIRECTION,
) => {
  const bounds = boundsByDirection[direction][category];
  const key = direction === "higher" ? bounds.lower : bounds.upper;
  return distribution[key];
};
