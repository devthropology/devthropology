import { useEffect, useMemo, useRef } from "react";
import Chart from "chart.js/auto";
import type {
  TrendsPrSizeBucket,
  TrendsPrSizeMonthlyPoint,
} from "../../../../shared/models/trendsInsights";
import { getBufferedBounds, getNiceStepSize } from "./chartScale";
import { renderLineChartTooltip } from "./lineChartTooltip";
import { PR_SIZE_BUCKET_SHORT_LABELS } from "./prSizeBuckets";
import { getYearColor } from "./yearColors";
import type {
  ReviewTimingFamilyKey,
  ReviewTimingMetricKey,
} from "./PrReviewTimingSeasonalityChart";

export const SIZE_REVIEW_MODES = [
  { key: "timing", label: "Timing" },
  { key: "rounds", label: "Rounds" },
] as const;

export const SIZE_REVIEW_ROUNDS_SCOPES = [
  { key: "human", label: "Human Only" },
  { key: "all", label: "Human + Bot" },
] as const;

export type SizeReviewMode = (typeof SIZE_REVIEW_MODES)[number]["key"];
export type SizeReviewRoundsScopeKey = (typeof SIZE_REVIEW_ROUNDS_SCOPES)[number]["key"];

type Props = {
  sizePoints: TrendsPrSizeMonthlyPoint[];
  mode: SizeReviewMode;
  timingMetric: ReviewTimingMetricKey;
  timingFamily: ReviewTimingFamilyKey;
  roundsScope: SizeReviewRoundsScopeKey;
  selectedYears: number[];
  selectedSizeBuckets: TrendsPrSizeBucket[];
};

type SizeDataset = {
  label: string;
  data: Array<number | null>;
  borderColor: string;
  backgroundColor: string;
  pointRadius: number;
  pointHoverRadius: number;
  borderWidth: number;
  tension: number;
  borderDash?: number[];
  year: number;
  sizeBucket: TrendsPrSizeBucket;
};

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function formatDurationHours(value: number) {
  if (value < 1) {
    return `${Math.round(value * 60)}m`;
  }
  if (value < 24) {
    return `${value.toFixed(value >= 10 ? 0 : 1)}h`;
  }
  const days = value / 24;
  return `${days.toFixed(days >= 10 ? 0 : 1)}d`;
}

function formatRoundsValue(value: number) {
  return value.toFixed(value % 1 === 0 ? 0 : value >= 10 ? 1 : 2);
}

function getPrSizeMetricField(
  family: ReviewTimingFamilyKey,
  metric: ReviewTimingMetricKey,
): keyof TrendsPrSizeMonthlyPoint {
  if (family === "review") {
    if (metric === "p50") return "p50TimeToFirstReviewHours";
    if (metric === "p75") return "p75TimeToFirstReviewHours";
    return "p90TimeToFirstReviewHours";
  }

  if (metric === "p50") return "p50TimeToEffectiveApprovalHours";
  if (metric === "p75") return "p75TimeToEffectiveApprovalHours";
  return "p90TimeToEffectiveApprovalHours";
}

function getPrSizeRoundsMetricField(
  scope: SizeReviewRoundsScopeKey,
): keyof TrendsPrSizeMonthlyPoint {
  return scope === "all" ? "avgAllRounds" : "avgRounds";
}

function formatDeltaPercent(currentValue: number, previousValue: number | null) {
  if (previousValue === null || previousValue === 0) {
    return null;
  }

  const deltaPercent = ((currentValue - previousValue) / previousValue) * 100;
  const rounded = Math.round(deltaPercent);
  if (rounded === 0) {
    return "0%";
  }

  return `${rounded > 0 ? "↑" : "↓"} ${Math.abs(rounded)}%`;
}

function getDeltaColor(currentValue: number, previousValue: number | null) {
  if (previousValue === null || previousValue === 0 || currentValue === previousValue) {
    return "rgba(255, 255, 255, 0.92)";
  }

  return currentValue > previousValue ? "#f87171" : "#4ade80";
}

function getComparisonValue(
  datasets: SizeDataset[],
  year: number,
  sizeBucket: TrendsPrSizeBucket,
  monthIndex: number,
) {
  const comparisonDataset = datasets.find(
    (dataset) => dataset.sizeBucket === sizeBucket && dataset.year < year,
  );
  if (!comparisonDataset) {
    return null;
  }

  return comparisonDataset.data[monthIndex] ?? null;
}

function getSeriesLabel(year: number, sizeBucket: TrendsPrSizeBucket) {
  return `${year} ${PR_SIZE_BUCKET_SHORT_LABELS[sizeBucket]}`;
}

function getBucketDash(sizeBucket: TrendsPrSizeBucket, selectedSizeBuckets: TrendsPrSizeBucket[]) {
  const bucketIndex = selectedSizeBuckets.indexOf(sizeBucket);
  if (bucketIndex <= 0) {
    return undefined;
  }

  if (bucketIndex === 1) {
    return [2, 4];
  }

  return undefined;
}

function getBucketBorderWidth(
  sizeBucket: TrendsPrSizeBucket,
  selectedSizeBuckets: TrendsPrSizeBucket[],
) {
  return selectedSizeBuckets.indexOf(sizeBucket) === 2 ? 4 : 2.5;
}

export function PrReviewTimingBySizeChart({
  sizePoints,
  mode,
  timingMetric,
  timingFamily,
  roundsScope,
  selectedYears,
  selectedSizeBuckets,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const datasets = useMemo(() => {
    const years = [...selectedYears].sort((a, b) => b - a);

    const field =
      mode === "timing"
        ? getPrSizeMetricField(timingFamily, timingMetric)
        : getPrSizeRoundsMetricField(roundsScope);
    return selectedSizeBuckets.flatMap((sizeBucket) =>
      years.map(
        (year) =>
          ({
            label: getSeriesLabel(year, sizeBucket),
            data: Array.from({ length: 12 }, (_, monthIndex) => {
              const point = sizePoints.find(
                (entry) =>
                  entry.year === year &&
                  entry.month === monthIndex + 1 &&
                  entry.sizeBucket === sizeBucket,
              );
              const value = point?.[field];
              return typeof value === "number" ? value : null;
            }),
            borderColor: getYearColor(year),
            backgroundColor: getYearColor(year),
            pointRadius: 3,
            pointHoverRadius: 5,
            borderWidth: getBucketBorderWidth(sizeBucket, selectedSizeBuckets),
            tension: 0.28,
            borderDash: getBucketDash(sizeBucket, selectedSizeBuckets),
            year,
            sizeBucket,
          }) satisfies SizeDataset,
      ),
    );
  }, [
    mode,
    roundsScope,
    selectedSizeBuckets,
    selectedYears,
    sizePoints,
    timingFamily,
    timingMetric,
  ]);

  const hasSingleSizeBucketSelected = selectedSizeBuckets.length === 1;

  const yAxisBounds = useMemo(() => {
    const values = datasets.flatMap((dataset) =>
      dataset.data.filter((value): value is number => value !== null),
    );

    if (values.length === 0) {
      return mode === "timing" ? { min: 0, max: 24, stepSize: 4 } : { min: 0, max: 5, stepSize: 1 };
    }

    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const stepSize = getNiceStepSize(maxValue, maxValue - minValue);
    const bounds = getBufferedBounds(minValue, maxValue, stepSize);

    return {
      min: Math.max(0, bounds.min),
      max: bounds.max,
      stepSize,
    };
  }, [datasets, mode]);

  useEffect(() => {
    if (!canvasRef.current || datasets.length === 0) {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
      return;
    }

    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: {
        labels: MONTH_LABELS,
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: false,
            external: ({ chart, tooltip }) => {
              const entries = (tooltip.dataPoints ?? []).flatMap((point) => {
                const value = point.parsed.y;
                if (value === null || value === undefined) {
                  return [];
                }

                const dataset = point.dataset as typeof point.dataset & {
                  year: number;
                  sizeBucket: TrendsPrSizeBucket;
                };
                const comparisonValue = getComparisonValue(
                  datasets,
                  dataset.year,
                  dataset.sizeBucket,
                  point.dataIndex,
                );

                return [
                  {
                    sizeBucket: dataset.sizeBucket,
                    row: {
                      label: String(dataset.year),
                      value:
                        mode === "timing"
                          ? formatDurationHours(value)
                          : `${formatRoundsValue(value)} rounds`,
                      delta: formatDeltaPercent(value, comparisonValue),
                      deltaColor: getDeltaColor(value, comparisonValue),
                      seriesColor:
                        typeof point.dataset.borderColor === "string"
                          ? point.dataset.borderColor
                          : "#ffffff",
                    },
                  },
                ];
              });

              if (hasSingleSizeBucketSelected) {
                renderLineChartTooltip({
                  chart,
                  tooltip,
                  tooltipRef,
                  rows: entries.map((entry) => entry.row),
                });
                return;
              }

              renderLineChartTooltip({
                chart,
                tooltip,
                tooltipRef,
                sections: selectedSizeBuckets.map((sizeBucket) => ({
                  label: PR_SIZE_BUCKET_SHORT_LABELS[sizeBucket],
                  strokeColor: "rgba(255, 255, 255, 0.9)",
                  strokeWidth: getBucketBorderWidth(sizeBucket, selectedSizeBuckets),
                  strokeDash: getBucketDash(sizeBucket, selectedSizeBuckets),
                  rows: entries
                    .filter((entry) => entry.sizeBucket === sizeBucket)
                    .map((entry) => entry.row),
                })),
              });
            },
          },
        },
        scales: {
          x: {
            ticks: { color: "rgba(255, 255, 255, 0.72)" },
            grid: { color: "rgba(255, 255, 255, 0.06)" },
          },
          y: {
            min: yAxisBounds.min,
            max: yAxisBounds.max,
            ticks: {
              color: "rgba(255, 255, 255, 0.72)",
              stepSize: yAxisBounds.stepSize,
              callback: (value) => {
                const numericValue = typeof value === "number" ? value : Number(value);
                if (!Number.isFinite(numericValue)) {
                  return "";
                }
                return mode === "timing"
                  ? formatDurationHours(numericValue)
                  : formatRoundsValue(numericValue);
              },
            },
            grid: { color: "rgba(255, 255, 255, 0.06)" },
          },
        },
      },
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [
    datasets,
    hasSingleSizeBucketSelected,
    mode,
    selectedSizeBuckets,
    yAxisBounds.max,
    yAxisBounds.min,
    yAxisBounds.stepSize,
  ]);

  if (datasets.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        Pick at least one size and one year to compare.
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <canvas ref={canvasRef} />
    </div>
  );
}
