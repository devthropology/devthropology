import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Chart from "chart.js/auto";

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

export function WeeklyMergeTimesChart({ weeklyTrends }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const [isMobile, setIsMobile] = useState(getIsMobileViewport);

  const labels = useMemo(
    () =>
      weeklyTrends.map((week, index) =>
        formatWeekTickLabel(week.weekStartDate, index, weeklyTrends),
      ),
    [weeklyTrends],
  );

  const visibleMonthTickIndexes = useMemo(
    () => getVisibleMonthTickIndexes(labels, isMobile ? 6 : Number.MAX_SAFE_INTEGER),
    [isMobile, labels],
  );

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
    if (!canvasRef.current || !weeklyTrends.length) return;

    // Cleanup existing chart
    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    // Filter out null values and create data arrays
    const avgData = weeklyTrends.map((week) => week.avgTimeToMergeHours);
    const medianData = weeklyTrends.map((week) => week.medianTimeToMergeHours);

    chartRef.current = new Chart(canvasRef.current!, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Average Time",
            data: avgData,
            borderColor: "rgb(130, 202, 157)",
            backgroundColor: "rgba(130, 202, 157, 0.1)",
            borderWidth: 2,
            fill: false,
            tension: 0.1,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: "rgb(130, 202, 157)",
            spanGaps: true, // Connect lines across null values
          },
          {
            label: "Median Time",
            data: medianData,
            borderColor: "rgb(96, 165, 250)",
            backgroundColor: "rgba(96, 165, 250, 0.1)",
            borderWidth: 2,
            fill: false,
            tension: 0.1,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: "rgb(96, 165, 250)",
            spanGaps: true, // Connect lines across null values
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: false, // Remove title since it's in the MetricUnit
          },
          legend: {
            display: true, // Show legend to distinguish average vs median
            labels: {
              color: "white",
              usePointStyle: true,
              padding: 20,
            },
            position: "top",
          },
          tooltip: {
            callbacks: {
              label: function (context) {
                const value = context.parsed.y;
                if (value === null) return `${context.dataset.label}: N/A`;

                // Format hours to readable format
                let formattedValue;
                if (value < 1) {
                  formattedValue = `${Math.round(value * 60)}m`;
                } else if (value < 24) {
                  formattedValue = `${value.toFixed(1)}h`;
                } else {
                  formattedValue = `${Math.round(value / 24)}d`;
                }
                return `${context.dataset.label}: ${formattedValue}`;
              },
            },
          },
        },
        scales: {
          x: {
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
            ticks: {
              color: "white",
              callback: function (value) {
                const hours = Number(value);
                if (hours < 1) {
                  return `${Math.round(hours * 60)}m`;
                } else if (hours < 24) {
                  return `${hours.toFixed(1)}h`;
                } else {
                  return `${Math.round(hours / 24)}d`;
                }
              },
            },
            grid: {
              color: "rgba(255, 255, 255, 0.1)",
            },
          },
        },
        interaction: {
          intersect: false,
          mode: "index",
        },
      },
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [weeklyTrends, labels, visibleMonthTickIndexes]);

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

  // Check if we have any timing data
  const hasTimingData = weeklyTrends.some(
    (week) => week.avgTimeToMergeHours !== null || week.medianTimeToMergeHours !== null,
  );

  if (!hasTimingData) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        No timing data available for merged PRs
      </div>
    );
  }

  return (
    <div className="relative h-64 w-full">
      <canvas ref={canvasRef} />
    </div>
  );
}
