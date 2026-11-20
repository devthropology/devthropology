import { useEffect, useMemo, useRef } from "react";
import Chart from "chart.js/auto";
import type { TrendsReviewRoundsMonthlyPoint } from "../../../../shared/models/trendsInsights";
import { getBufferedBounds, getNiceStepSize } from "./chartScale";
import { renderLineChartTooltip } from "./lineChartTooltip";
import { getYearColor } from "./yearColors";

export const REVIEW_ROUNDS_METRICS = [
  { key: "avgRounds", label: "Avg", kind: "rounds" },
  { key: "pctAnyRound", label: "% 1+", kind: "percent" },
  { key: "pctTwoPlusRounds", label: "% 2+", kind: "percent" },
] as const;

export const REVIEW_ROUNDS_SCOPES = [
  { key: "human", label: "Human Only" },
  { key: "all", label: "Human + Bot" },
] as const;

export type ReviewRoundsMetricKey = (typeof REVIEW_ROUNDS_METRICS)[number]["key"];
export type ReviewRoundsScopeKey = (typeof REVIEW_ROUNDS_SCOPES)[number]["key"];

type Props = {
  points: TrendsReviewRoundsMonthlyPoint[];
  metric: ReviewRoundsMetricKey;
  scope: ReviewRoundsScopeKey;
  selectedYears: number[];
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

function formatMetricValue(value: number, kind: "rounds" | "percent") {
  if (kind === "percent") {
    return `${value.toFixed(1)}%`;
  }

  return value.toFixed(value % 1 === 0 ? 0 : 2);
}

function formatDelta(
  currentValue: number,
  previousValue: number | null,
  kind: "rounds" | "percent",
) {
  if (previousValue === null) {
    return null;
  }

  if (kind === "percent") {
    const deltaPoints = currentValue - previousValue;
    if (Math.abs(deltaPoints) < 0.05) {
      return "0.0 pp";
    }

    return `${deltaPoints > 0 ? "↑" : "↓"} ${Math.abs(deltaPoints).toFixed(1)} pp`;
  }

  if (previousValue === 0) {
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
  datasets: Array<{ label: string; data: Array<number | null> }>,
  currentYearLabel: string,
  monthIndex: number,
) {
  const datasetIndex = datasets.findIndex((dataset) => dataset.label === currentYearLabel);
  if (datasetIndex === -1) {
    return null;
  }

  const comparisonDataset = datasets[datasetIndex + 1];
  if (!comparisonDataset) {
    return null;
  }

  return comparisonDataset.data[monthIndex] ?? null;
}

function getSeriesColor(borderColor: unknown, yearLabel: string) {
  return typeof borderColor === "string" ? borderColor : getYearColor(Number(yearLabel));
}

function getMetricValue(
  point: TrendsReviewRoundsMonthlyPoint,
  metric: ReviewRoundsMetricKey,
  scope: ReviewRoundsScopeKey,
): number | null {
  if (scope === "all") {
    switch (metric) {
      case "avgRounds":
        return point.avgAllRounds;
      case "pctAnyRound":
        return point.pctAnyAllRounds;
      case "pctTwoPlusRounds":
        return point.pctTwoPlusAllRounds;
    }
  }

  return point[metric];
}

export function ReviewRoundsSeasonalityChart({ points, metric, scope, selectedYears }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const metricConfig =
    REVIEW_ROUNDS_METRICS.find((entry) => entry.key === metric) ?? REVIEW_ROUNDS_METRICS[0];

  const datasets = useMemo(() => {
    const years = [...selectedYears].sort((a, b) => b - a);

    return years.map((year) => {
      const values = Array.from({ length: 12 }, (_, monthIndex) => {
        const point = points.find((entry) => entry.year === year && entry.month === monthIndex + 1);
        return point ? getMetricValue(point, metric, scope) : null;
      });

      const color = getYearColor(year);

      return {
        label: String(year),
        data: values,
        borderColor: color,
        backgroundColor: color,
        borderWidth: 2,
        pointRadius: 3,
        pointHoverRadius: 5,
        tension: 0.3,
      };
    });
  }, [metric, points, scope, selectedYears]);

  const yAxisBounds = useMemo(() => {
    const values = datasets.flatMap((dataset) =>
      dataset.data.filter((value): value is number => value !== null),
    );

    if (values.length === 0) {
      return metricConfig.kind === "percent"
        ? { min: 0, max: 100, stepSize: 10 }
        : { min: 0, max: 5, stepSize: 1 };
    }

    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);

    if (metricConfig.kind === "percent") {
      const stepSize = maxValue <= 20 ? 2 : maxValue <= 60 ? 5 : 10;
      const bounds = getBufferedBounds(minValue, maxValue, stepSize);
      return {
        min: bounds.min,
        max: Math.min(100, bounds.max),
        stepSize,
      };
    }

    const range = maxValue - minValue;
    const stepSize = getNiceStepSize(maxValue, range);
    return getBufferedBounds(minValue, maxValue, stepSize);
  }, [datasets, metricConfig.kind]);

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
        interaction: {
          mode: "index",
          intersect: false,
        },
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            enabled: false,
            external: ({ chart, tooltip }) => {
              const rows = (tooltip.dataPoints ?? []).flatMap((point) => {
                const value = point.parsed.y;
                if (value === null || value === undefined) {
                  return [];
                }

                const yearLabel = String(point.dataset.label);
                const comparisonValue = getComparisonValue(datasets, yearLabel, point.dataIndex);
                const delta = formatDelta(value, comparisonValue, metricConfig.kind);

                return [
                  {
                    label: yearLabel,
                    value: formatMetricValue(value, metricConfig.kind),
                    delta,
                    deltaColor: getDeltaColor(value, comparisonValue),
                    seriesColor: getSeriesColor(point.dataset.borderColor, yearLabel),
                  },
                ];
              });

              renderLineChartTooltip({ chart, tooltip, tooltipRef, rows });
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: "rgba(255, 255, 255, 0.72)",
            },
            grid: {
              color: "rgba(255, 255, 255, 0.06)",
            },
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
                return Number.isFinite(numericValue)
                  ? formatMetricValue(numericValue, metricConfig.kind)
                  : "";
              },
            },
            grid: {
              color: "rgba(255, 255, 255, 0.06)",
            },
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
  }, [datasets, metricConfig.kind, yAxisBounds.max, yAxisBounds.min, yAxisBounds.stepSize]);

  if (datasets.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        No review-round history yet
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <canvas ref={canvasRef} />
    </div>
  );
}
