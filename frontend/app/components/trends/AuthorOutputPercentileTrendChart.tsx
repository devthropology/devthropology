import { useEffect, useMemo, useRef } from "react";
import Chart from "chart.js/auto";
import type { TrendsAuthorOutputMonthlyPoint } from "../../../../shared/models/trendsInsights";
import { getBufferedBounds, getNiceStepSize } from "./chartScale";
import { renderLineChartTooltip } from "./lineChartTooltip";
import { getYearColor } from "./yearColors";

export const AUTHOR_OUTPUT_FAMILIES = [
  { key: "mergedPrs", label: "PRs" },
  { key: "linesChanged", label: "Lines" },
] as const;

export const AUTHOR_OUTPUT_PERCENTILE_METRICS = [
  { key: "avg", label: "Avg" },
  { key: "p50", label: "Median" },
  { key: "p75", label: "P75" },
  { key: "p90", label: "P90" },
] as const;

export type AuthorOutputFamilyKey = (typeof AUTHOR_OUTPUT_FAMILIES)[number]["key"];
export type AuthorOutputPercentileMetricKey =
  (typeof AUTHOR_OUTPUT_PERCENTILE_METRICS)[number]["key"];

type Props = {
  points: TrendsAuthorOutputMonthlyPoint[];
  family: AuthorOutputFamilyKey;
  metric: AuthorOutputPercentileMetricKey;
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

function getMetricField(
  family: AuthorOutputFamilyKey,
  metric: AuthorOutputPercentileMetricKey,
): keyof TrendsAuthorOutputMonthlyPoint {
  if (family === "mergedPrs") {
    if (metric === "avg") return "avgMergedPrsPerAuthor";
    if (metric === "p50") return "p50MergedPrsPerAuthor";
    if (metric === "p75") return "p75MergedPrsPerAuthor";
    return "p90MergedPrsPerAuthor";
  }

  if (metric === "avg") return "avgLinesChangedPerAuthor";
  if (metric === "p50") return "p50LinesChangedPerAuthor";
  if (metric === "p75") return "p75LinesChangedPerAuthor";
  return "p90LinesChangedPerAuthor";
}

function formatNumber(value: number) {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  });
}

function formatValue(value: number, family: AuthorOutputFamilyKey) {
  const suffix = family === "mergedPrs" ? (value === 1 ? "PR" : "PRs") : "lines";
  return `${formatNumber(value)} ${suffix}`;
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

  return currentValue > previousValue ? "#4ade80" : "#f87171";
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

export function AuthorOutputPercentileTrendChart({ points, family, metric, selectedYears }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const metricField = useMemo(() => getMetricField(family, metric), [family, metric]);

  const datasets = useMemo(() => {
    const years = [...selectedYears].sort((a, b) => b - a);

    return years.map((year) => ({
      label: String(year),
      data: Array.from({ length: 12 }, (_, monthIndex) => {
        const point = points.find((entry) => entry.year === year && entry.month === monthIndex + 1);
        return point?.[metricField] ?? null;
      }),
      borderColor: getYearColor(year),
      backgroundColor: getYearColor(year),
      pointRadius: 3,
      pointHoverRadius: 5,
      borderWidth: 2.5,
      tension: 0.28,
    }));
  }, [metricField, points, selectedYears]);

  const yAxisBounds = useMemo(() => {
    const values = datasets.flatMap((dataset) =>
      dataset.data.filter((value): value is number => value !== null),
    );

    if (values.length === 0) {
      return { min: 0, max: 100, stepSize: 10 };
    }

    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const range = maxValue - minValue;
    const stepSize = getNiceStepSize(maxValue, range);

    return getBufferedBounds(minValue, maxValue, stepSize);
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
                const delta = formatDeltaPercent(value, comparisonValue);

                return [
                  {
                    label: yearLabel,
                    value: formatValue(value, family),
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
              color: "rgba(255, 255, 255, 0.04)",
            },
          },
          y: {
            min: yAxisBounds.min,
            max: yAxisBounds.max,
            ticks: {
              color: "rgba(255, 255, 255, 0.72)",
              stepSize: yAxisBounds.stepSize,
              callback: (value) => formatNumber(Number(value)),
            },
            grid: {
              color: "rgba(255, 255, 255, 0.08)",
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
  }, [datasets, family, yAxisBounds.max, yAxisBounds.min, yAxisBounds.stepSize]);

  if (datasets.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        Pick one or more years to compare.
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <canvas ref={canvasRef} />
    </div>
  );
}
