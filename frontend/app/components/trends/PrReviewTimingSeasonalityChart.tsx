import { useEffect, useMemo, useRef } from "react";
import Chart from "chart.js/auto";
import type { TrendsReviewRoundsMonthlyPoint } from "../../../../shared/models/trendsInsights";
import { getBufferedBounds, getNiceStepSize } from "./chartScale";
import { renderLineChartTooltip } from "./lineChartTooltip";
import { getYearColor } from "./yearColors";

export const REVIEW_TIMING_METRICS = [
  { key: "p50", label: "Median" },
  { key: "p75", label: "P75" },
  { key: "p90", label: "P90" },
] as const;

export const REVIEW_TIMING_FAMILIES = [
  { key: "review", label: "First Review" },
  { key: "approval", label: "Approval" },
] as const;

export type ReviewTimingMetricKey = (typeof REVIEW_TIMING_METRICS)[number]["key"];
export type ReviewTimingFamilyKey = (typeof REVIEW_TIMING_FAMILIES)[number]["key"];

type Props = {
  points: TrendsReviewRoundsMonthlyPoint[];
  metric: ReviewTimingMetricKey;
  selectedFamilies: ReviewTimingFamilyKey[];
  selectedYears: number[];
};

type TimingDataset = {
  label: string;
  data: Array<number | null>;
  borderColor: string;
  backgroundColor: string;
  borderWidth: number;
  pointRadius: number;
  pointHoverRadius: number;
  tension: number;
  borderDash?: number[];
  family: ReviewTimingFamilyKey;
  year: number;
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

function getMetricField(
  family: ReviewTimingFamilyKey,
  metric: ReviewTimingMetricKey,
): keyof TrendsReviewRoundsMonthlyPoint {
  if (family === "review") {
    if (metric === "p50") return "p50TimeToFirstReviewHours";
    if (metric === "p75") return "p75TimeToFirstReviewHours";
    return "p90TimeToFirstReviewHours";
  }

  if (metric === "p50") return "p50TimeToEffectiveApprovalHours";
  if (metric === "p75") return "p75TimeToEffectiveApprovalHours";
  return "p90TimeToEffectiveApprovalHours";
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
  datasets: TimingDataset[],
  family: ReviewTimingFamilyKey,
  year: number,
  monthIndex: number,
) {
  const comparisonDataset = datasets.find(
    (dataset) => dataset.family === family && dataset.year < year,
  );
  if (!comparisonDataset) {
    return null;
  }

  return comparisonDataset.data[monthIndex] ?? null;
}

export function PrReviewTimingSeasonalityChart({
  points,
  metric,
  selectedFamilies,
  selectedYears,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const datasets = useMemo(() => {
    const years = [...selectedYears].sort((a, b) => b - a);
    const orderedFamilies = REVIEW_TIMING_FAMILIES.map((option) => option.key).filter((family) =>
      selectedFamilies.includes(family),
    );

    return years.flatMap((year) => {
      const color = getYearColor(year);

      return orderedFamilies.map((family) => {
        const field = getMetricField(family, metric);
        const lineLabel = family === "review" ? "First Review Time" : "Approval Time";
        const data = Array.from({ length: 12 }, (_, monthIndex) => {
          const point = points.find(
            (entry) => entry.year === year && entry.month === monthIndex + 1,
          );
          const value = point?.[field];
          return typeof value === "number" ? value : null;
        });

        return {
          label: `${year} ${lineLabel}`,
          data,
          borderColor: color,
          backgroundColor: color,
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          tension: 0.3,
          borderDash: family === "approval" ? [6, 4] : undefined,
          family,
          year,
        } satisfies TimingDataset;
      });
    });
  }, [metric, points, selectedFamilies, selectedYears]);

  const hasSingleFamilySelected = selectedFamilies.length === 1;

  const yAxisBounds = useMemo(() => {
    const values = datasets.flatMap((dataset) =>
      dataset.data.filter((value): value is number => value !== null),
    );

    if (values.length === 0) {
      return { min: 0, max: 24, stepSize: 4 };
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
  }, [datasets]);

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
      data: { labels: MONTH_LABELS, datasets },
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
                  family: ReviewTimingFamilyKey;
                  year: number;
                };

                const comparisonValue = getComparisonValue(
                  datasets,
                  dataset.family,
                  dataset.year,
                  point.dataIndex,
                );

                return [
                  {
                    family: dataset.family,
                    row: {
                      label: hasSingleFamilySelected ? String(dataset.year) : String(dataset.year),
                      value: formatDurationHours(value),
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

              if (hasSingleFamilySelected) {
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
                sections: REVIEW_TIMING_FAMILIES.filter((family) =>
                  selectedFamilies.includes(family.key),
                ).map((family) => ({
                  label: family.label,
                  rows: entries
                    .filter((entry) => entry.family === family.key)
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
            beginAtZero: false,
            min: yAxisBounds.min,
            max: yAxisBounds.max,
            ticks: {
              color: "rgba(255, 255, 255, 0.72)",
              stepSize: yAxisBounds.stepSize,
              callback: (value) => {
                const numericValue = typeof value === "number" ? value : Number(value);
                return Number.isFinite(numericValue) ? formatDurationHours(numericValue) : "";
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
    hasSingleFamilySelected,
    selectedFamilies,
    yAxisBounds.max,
    yAxisBounds.min,
    yAxisBounds.stepSize,
  ]);

  if (datasets.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        Select First Review Time or Approval Time
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <canvas ref={canvasRef} />
    </div>
  );
}
