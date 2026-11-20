import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Chart from "chart.js/auto";
import type { ChartDataset } from "chart.js";
import type { ViewMode } from "./ChartCard";
import { useChartNormalization } from "../../utils/chartHelpers";

interface CustomDataset extends ChartDataset<"bar"> {
  rawValues?: number[];
}

const bucketOrder = [
  { key: "new", fallbackTitle: "New", shortLabel: "0–90d", color: "#A5F3FC" },
  { key: "emerging", fallbackTitle: "Emerging", shortLabel: "90d–1y", color: "#60A5FA" },
  { key: "core", fallbackTitle: "Core", shortLabel: "1–2y", color: "#3B82F6" },
  { key: "established", fallbackTitle: "Established", shortLabel: "2–5y", color: "#8B5CF6" },
  { key: "veteran", fallbackTitle: "Veteran", shortLabel: "5y+", color: "#F59E0B" },
];

interface WeeklyVolume {
  weekStartDate: string;
  prsMerged: number;
  ageBuckets?: Array<{ key: string; title: string; range: string; count: number }>;
  linesAdded: number;
  linesDeleted: number;
  filesChanged: number;
  avgTimeToMergeHours: number | null;
  medianTimeToMergeHours: number | null;
}

interface Props {
  weeklyTrends: WeeklyVolume[];
  viewMode: ViewMode;
}

function getTooltipBucketLabel(label: string | undefined) {
  return label?.replace(/\s*\([^)]*\)$/, "") ?? "";
}

function formatWeekTickLabel(dateString: string, index: number, allWeeks: WeeklyVolume[]): string {
  const date = new Date(dateString);
  const previousDate = index > 0 ? new Date(allWeeks[index - 1].weekStartDate) : null;
  const isNewMonth =
    previousDate === null ||
    previousDate.getUTCMonth() !== date.getUTCMonth() ||
    previousDate.getUTCFullYear() !== date.getUTCFullYear();

  if (!isNewMonth) {
    return "";
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
}

function formatTooltipDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function getIsMobileViewport(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.innerWidth < 640;
}

function getVisibleMonthTickIndexes(labels: string[], maxVisibleTicks: number): Set<number> {
  const monthIndexes = labels.reduce<number[]>((indexes, label, index) => {
    if (label) {
      indexes.push(index);
    }

    return indexes;
  }, []);

  if (monthIndexes.length <= maxVisibleTicks) {
    return new Set(monthIndexes);
  }

  const visibleIndexes = new Set<number>();
  const step = (monthIndexes.length - 1) / (maxVisibleTicks - 1);

  for (let tickIndex = 0; tickIndex < maxVisibleTicks; tickIndex += 1) {
    visibleIndexes.add(monthIndexes[Math.round(tickIndex * step)]);
  }

  return visibleIndexes;
}

export function WeeklyPRTrendsChart({ weeklyTrends, viewMode }: Props) {
  const [isMobile, setIsMobile] = useState(getIsMobileViewport);
  const hasBuckets = useMemo(
    () => weeklyTrends.some((week) => (week.ageBuckets ?? []).some((bucket) => bucket.count > 0)),
    [weeklyTrends],
  );

  const labels = useMemo(() => {
    return weeklyTrends.map((week, index) =>
      formatWeekTickLabel(week.weekStartDate, index, weeklyTrends),
    );
  }, [weeklyTrends]);

  const visibleMonthTickIndexes = useMemo(
    () => getVisibleMonthTickIndexes(labels, isMobile ? 6 : Number.MAX_SAFE_INTEGER),
    [isMobile, labels],
  );

  const bucketMeta = useMemo(() => {
    const meta = new Map<string, { title: string; range: string }>();
    weeklyTrends.forEach((week) => {
      (week.ageBuckets ?? []).forEach((bucket) => {
        if (!meta.has(bucket.key)) {
          meta.set(bucket.key, { title: bucket.title, range: bucket.range });
        }
      });
    });
    return meta;
  }, [weeklyTrends]);

  const rawData = useMemo(() => {
    return bucketOrder.map((bucket) =>
      weeklyTrends.map((week) => {
        const found = (week.ageBuckets ?? []).find((b) => b.key === bucket.key);
        return found?.count ?? 0;
      }),
    );
  }, [weeklyTrends]);

  const { totals, normalizedDatasets } = useChartNormalization(rawData, viewMode);

  const datasets = useMemo(() => {
    return bucketOrder.map((bucket, index) => {
      const rawValues = rawData[index] ?? [];
      const data = normalizedDatasets[index] ?? [];

      const meta = bucketMeta.get(bucket.key);
      const label = meta?.range ? `${meta.range}` : bucket.shortLabel;

      return {
        label,
        data,
        rawValues,
        backgroundColor: bucket.color,
        borderColor: bucket.color,
        borderWidth: 1,
        stack: "age",
      };
    }) as CustomDataset[];
  }, [bucketMeta, normalizedDatasets, rawData]);

  const hasData = useMemo(() => totals.some((total) => total > 0), [totals]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const updateViewport = () => {
      setIsMobile(getIsMobileViewport());
    };

    updateViewport();
    window.addEventListener("resize", updateViewport);
    window.addEventListener("orientationchange", updateViewport);

    return () => {
      window.removeEventListener("resize", updateViewport);
      window.removeEventListener("orientationchange", updateViewport);
    };
  }, []);

  useEffect(() => {
    if (!canvasRef.current || !weeklyTrends.length || !hasBuckets || !hasData) {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
      return;
    }

    // Cleanup existing chart
    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    chartRef.current = new Chart(canvasRef.current!, {
      type: "bar",
      data: {
        labels,
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: false, // Remove title since it's in the MetricUnit
          },
          legend: {
            display: true,
            position: "top",
            title: {
              display: true,
              text: "Author Tenure",
              color: "white",
              font: { size: 12, weight: "bold" as const },
            },
            labels: { color: "white", usePointStyle: true, pointStyle: "rect", boxWidth: 10 },
          },
          tooltip: {
            mode: "index",
            intersect: false,
            itemSort: (a, b) => b.datasetIndex - a.datasetIndex,
            callbacks: {
              title: (items) => {
                const item = items[0];
                if (!item) return "";

                return formatTooltipDate(weeklyTrends[item.dataIndex].weekStartDate);
              },
              label: (context) => {
                const dataset = context.dataset as CustomDataset;
                const bucketLabel = dataset.label ?? "";
                const rawValue = dataset.rawValues?.[context.dataIndex] ?? 0;
                if (viewMode === "percentage") {
                  const percentage = context.parsed.y ?? 0;
                  return `${bucketLabel}: ${percentage.toFixed(1)}%`;
                }
                return `${bucketLabel}: ${rawValue.toLocaleString()}`;
              },
              footer: (items) => {
                if (viewMode === "percentage") {
                  return "";
                }
                const index = items[0]?.dataIndex ?? 0;
                const total = totals[index] ?? 0;
                return `Total: ${total.toLocaleString()} PRs`;
              },
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            title: {
              display: false, // Remove x-axis title
            },
            ticks: {
              color: "white",
              autoSkip: false,
              maxRotation: 0,
              minRotation: 0,
              callback: (_value, index) =>
                visibleMonthTickIndexes.has(index) ? (labels[index] ?? "") : "",
            },
            grid: {
              color: "rgba(255, 255, 255, 0.1)",
            },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            max: viewMode === "percentage" ? 100 : undefined,
            ticks: {
              color: "white",
              callback:
                viewMode === "percentage"
                  ? (value) => `${value}%`
                  : (value) => Number(value).toLocaleString(),
            },
            grid: {
              color: "rgba(255, 255, 255, 0.1)",
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
    weeklyTrends,
    viewMode,
    labels,
    datasets,
    totals,
    hasBuckets,
    hasData,
    visibleMonthTickIndexes,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
      }
    };
  }, []);

  if (!weeklyTrends.length) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        No weekly trend data available
      </div>
    );
  }

  if (!hasBuckets) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        No contributor age data available for this window
      </div>
    );
  }

  return (
    <div className="relative h-64 w-full">
      <canvas ref={canvasRef} />
    </div>
  );
}
