import { useEffect, useMemo, useRef } from "react";
import Chart from "chart.js/auto";
import type {
  TrendsAiAssistedModelMonthlyPoint,
  TrendsAiAssistedMonthlyPoint,
} from "../../../../shared/models/trendsInsights";
import { getBufferedBounds, getNiceStepSize } from "./chartScale";
import { renderLineChartTooltip } from "./lineChartTooltip";
import { getYearColor } from "./yearColors";

export const AI_ASSISTED_METRICS = [
  { key: "pctAiAssistedPrs", label: "% of PRs" },
  { key: "aiAssistedPrs", label: "PR Count" },
] as const;

export type AiAssistedMetricKey = (typeof AI_ASSISTED_METRICS)[number]["key"];

type Props = {
  points: TrendsAiAssistedMonthlyPoint[];
  modelPoints: TrendsAiAssistedModelMonthlyPoint[];
  selectedYears: number[];
  metric: AiAssistedMetricKey;
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

function formatPointValue(value: number, metric: AiAssistedMetricKey) {
  if (metric === "pctAiAssistedPrs") {
    return `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`;
  }

  return value.toLocaleString();
}

export function AiAssistedTrendChart({ points, modelPoints, selectedYears, metric }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const datasets = useMemo(() => {
    const years = [...selectedYears].sort((a, b) => b - a);

    return years.map((year) => ({
      label: String(year),
      data: Array.from({ length: 12 }, (_, monthIndex) => {
        const point = points.find((entry) => entry.year === year && entry.month === monthIndex + 1);
        return point?.[metric] ?? null;
      }),
      borderColor: getYearColor(year),
      backgroundColor: getYearColor(year),
      pointRadius: 3,
      pointHoverRadius: 5,
      borderWidth: 2.5,
      tension: 0.28,
    }));
  }, [metric, points, selectedYears]);

  const pointsByYearMonth = useMemo(() => {
    const map = new Map<string, TrendsAiAssistedMonthlyPoint>();
    for (const point of points) {
      map.set(`${point.year}-${point.month}`, point);
    }
    return map;
  }, [points]);

  const modelPointsByYearMonth = useMemo(() => {
    const map = new Map<string, TrendsAiAssistedModelMonthlyPoint[]>();
    for (const point of modelPoints) {
      const key = `${point.year}-${point.month}`;
      const current = map.get(key) ?? [];
      current.push(point);
      map.set(key, current);
    }

    for (const [key, entries] of map.entries()) {
      map.set(
        key,
        [...entries].sort((left, right) => right.pctAiAssistedPrs - left.pctAiAssistedPrs),
      );
    }

    return map;
  }, [modelPoints]);

  const yAxisBounds = useMemo(() => {
    const values = datasets.flatMap((dataset) =>
      dataset.data.filter((value): value is number => value !== null),
    );

    if (values.length === 0) {
      return { min: 0, max: metric === "pctAiAssistedPrs" ? 100 : 10, stepSize: 10 };
    }

    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const stepSize = getNiceStepSize(maxValue, maxValue - minValue);
    const bounds = getBufferedBounds(minValue, maxValue, stepSize);

    if (metric === "pctAiAssistedPrs") {
      return {
        min: 0,
        max: Math.min(100, Math.max(bounds.max, stepSize)),
        stepSize,
      };
    }

    return bounds;
  }, [datasets, metric]);

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
              const sections = (tooltip.dataPoints ?? []).flatMap((point) => {
                const year = Number(point.dataset.label);
                const month = point.dataIndex + 1;
                const details = pointsByYearMonth.get(`${year}-${month}`);
                const breakdown = modelPointsByYearMonth.get(`${year}-${month}`) ?? [];
                const value = point.parsed.y;

                if (!details || value === null || value === undefined) {
                  return [];
                }

                const seriesColor =
                  typeof point.dataset.borderColor === "string"
                    ? point.dataset.borderColor
                    : getYearColor(year);

                return [
                  {
                    label: `${year}: ${metric === "pctAiAssistedPrs" ? formatPointValue(value, metric) : `${formatPointValue(value, metric)} PRs`}`,
                    rows: breakdown.slice(0, 5).map((modelPoint) => ({
                      label: modelPoint.model,
                      value:
                        metric === "pctAiAssistedPrs"
                          ? `${modelPoint.pctAiAssistedPrs.toFixed(modelPoint.pctAiAssistedPrs % 1 === 0 ? 0 : 1)}%`
                          : `${modelPoint.aiAssistedPrs.toLocaleString()} PRs`,
                      seriesColor,
                    })),
                  },
                ];
              });

              renderLineChartTooltip({ chart, tooltip, tooltipRef, sections });
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
              callback: (value) =>
                metric === "pctAiAssistedPrs"
                  ? formatPointValue(Number(value), metric)
                  : Number(value).toLocaleString(),
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
  }, [
    datasets,
    metric,
    modelPointsByYearMonth,
    pointsByYearMonth,
    yAxisBounds.max,
    yAxisBounds.min,
    yAxisBounds.stepSize,
  ]);

  const hasVisibleData = datasets.some((dataset) => dataset.data.some((value) => value !== null));

  if (datasets.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        Pick one or more years to compare.
      </div>
    );
  }

  if (!hasVisibleData) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        No AI-assisted pull requests match this filter yet.
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <canvas ref={canvasRef} />
    </div>
  );
}
