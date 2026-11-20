import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Chart from "chart.js/auto";
import type { ChartDataset } from "chart.js";
import type { ViewMode } from "./ChartCard";
import { useChartNormalization } from "../../utils/chartHelpers";

interface CustomDataset extends ChartDataset<"bar"> {
  rawValues?: number[];
}

interface WeeklyVolume {
  weekStartDate: string;
  prsMerged: number;
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

export function WeeklyLinesChart({ weeklyTrends, viewMode }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const [isMobile, setIsMobile] = useState(getIsMobileViewport);

  const { labels, rawData } = useMemo(() => {
    const labels = weeklyTrends.map((week, index) =>
      formatWeekTickLabel(week.weekStartDate, index, weeklyTrends),
    );

    const rawData = [
      weeklyTrends.map((week) => week.linesAdded),
      weeklyTrends.map((week) => week.linesDeleted),
    ];

    return { labels, rawData };
  }, [weeklyTrends]);

  const visibleMonthTickIndexes = useMemo(
    () => getVisibleMonthTickIndexes(labels, isMobile ? 6 : Number.MAX_SAFE_INTEGER),
    [isMobile, labels],
  );

  const { totals, normalizedDatasets } = useChartNormalization(rawData, viewMode);

  const [additionsData = [], deletionsData = []] = normalizedDatasets;
  const [additionsRaw = [], deletionsRaw = []] = rawData;

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
    if (!canvasRef.current || !weeklyTrends.length) {
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
        datasets: [
          {
            label: "Additions",
            data: additionsData,
            rawValues: additionsRaw,
            backgroundColor: "rgba(34, 197, 94, 0.7)",
            borderColor: "rgb(34, 197, 94)",
            borderWidth: 1,
            stack: "lines",
          },
          {
            label: "Deletions",
            data: deletionsData,
            rawValues: deletionsRaw,
            backgroundColor: "rgba(239, 68, 68, 0.7)",
            borderColor: "rgb(239, 68, 68)",
            borderWidth: 1,
            stack: "lines",
          },
        ] as CustomDataset[],
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
            labels: {
              color: "white",
              usePointStyle: true,
              pointStyle: "rect",
            },
          },
          tooltip: {
            itemSort: (a, b) => b.datasetIndex - a.datasetIndex,
            callbacks: {
              title: (tooltipItems) => {
                const item = tooltipItems[0];
                if (!item) return "";

                return formatTooltipDate(weeklyTrends[item.dataIndex].weekStartDate);
              },
              label: (context) => {
                const dataset = context.dataset as CustomDataset;
                const rawValue = dataset.rawValues?.[context.dataIndex] ?? 0;
                if (viewMode === "percentage") {
                  const percentage = context.parsed.y ?? 0;
                  return `${dataset.label ?? ""}: ${percentage.toFixed(
                    1,
                  )}% (${rawValue.toLocaleString()} lines)`;
                }
                const prefix = dataset.label === "Deletions" ? "-" : "+";
                return `${dataset.label ?? ""}: ${prefix + rawValue.toLocaleString()} lines`;
              },
              footer: (items) => {
                const index = items[0]?.dataIndex ?? 0;
                const total = totals[index] ?? 0;
                return `Total: ${total.toLocaleString()} lines`;
              },
            },
            backgroundColor: "rgba(0, 0, 0, 0.8)",
            titleColor: "white",
            bodyColor: "white",
          },
        },
        scales: {
          x: {
            stacked: true, // Enable stacking
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
            beginAtZero: true,
            stacked: true, // Enable stacking
            ticks: {
              color: "white",
              callback:
                viewMode === "percentage"
                  ? (value) => `${value}%`
                  : (value) => Number(value).toLocaleString(),
            },
            max: viewMode === "percentage" ? 100 : undefined,
            grid: {
              color: "rgba(255, 255, 255, 0.1)",
            },
          },
        },
        interaction: {
          mode: "index",
          intersect: false,
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
    additionsData,
    deletionsData,
    additionsRaw,
    deletionsRaw,
    visibleMonthTickIndexes,
    totals,
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

  return (
    <div className="relative h-64 w-full">
      <canvas ref={canvasRef} />
    </div>
  );
}
