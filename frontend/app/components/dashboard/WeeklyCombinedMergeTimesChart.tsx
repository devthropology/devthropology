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

function formatTooltipDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatDuration(hours: number | null): string {
  if (hours === null) return "N/A";

  if (hours < 1) {
    return `${Math.round(hours * 60)} minutes`;
  }

  if (hours < 48) {
    return `${hours.toFixed(1)} hours`;
  }

  return `${(hours / 24).toFixed(1)} days`;
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

export function WeeklyCombinedMergeTimesChart({ weeklyTrends }: Props) {
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

    // Show monthly boundaries on the axis while preserving weekly points.
    // Create data arrays
    const medianData = weeklyTrends.map((week) => week.medianTimeToMergeHours);
    const avgData = weeklyTrends.map((week) => week.avgTimeToMergeHours);

    // Calculate max value for Y-axis configuration
    const allValues = [...medianData, ...avgData].filter((v) => v !== null) as number[];
    const maxValue = Math.max(...allValues, 0);

    // Determine appropriate step size for "nice" intervals
    let suggestedStepSize: number | undefined;
    if (maxValue < 2) {
      // Sub-hour range: use 15-minute increments (0.25 hours)
      suggestedStepSize = 0.25;
    } else if (maxValue < 24) {
      // Hours range: use 4-hour increments
      suggestedStepSize = 4;
    } else if (maxValue < 120) {
      // Days range (up to 5 days): use 12-hour (0.5 day) increments
      suggestedStepSize = 12;
    } else {
      // Larger range: use 24-hour (1 day) increments
      suggestedStepSize = 24;
    }

    chartRef.current = new Chart(canvasRef.current!, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Median",
            data: medianData,
            borderColor: "rgb(59, 130, 246)",
            backgroundColor: "rgba(59, 130, 246, 0.1)",
            borderWidth: 3,
            fill: false,
            tension: 0.1,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: "rgb(59, 130, 246)",
            spanGaps: true,
            borderDash: [],
          },
          {
            label: "Average",
            data: avgData,
            borderColor: "rgb(168, 85, 247)",
            backgroundColor: "rgba(168, 85, 247, 0.1)",
            borderWidth: 2,
            fill: false,
            tension: 0.1,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: "rgb(168, 85, 247)",
            spanGaps: true,
            borderDash: [],
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: false,
          },
          legend: {
            display: true,
            position: "top",
            labels: {
              color: "white",
              usePointStyle: true,
              padding: 15,
              font: {
                size: 12,
              },
            },
          },
          tooltip: {
            callbacks: {
              title: function (items) {
                const item = items[0];
                if (!item) return "";

                return formatTooltipDate(weeklyTrends[item.dataIndex].weekStartDate);
              },
              label: function (context) {
                const value = context.parsed.y;
                const label = context.dataset.label || "";
                if (value === null) return `${label}: N/A`;

                return `${label}: ${formatDuration(value)}`;
              },
            },
          },
        },
        scales: {
          x: {
            title: {
              display: false,
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
              maxTicksLimit: 6,
              stepSize: suggestedStepSize,
              callback: function (value) {
                const hours = Number(value);
                if (hours === 0) {
                  return "0h";
                } else if (hours < 1) {
                  const minutes = Math.round(hours * 60);
                  return `${minutes}m`;
                } else if (hours < 24) {
                  // For hours, show as decimal hours (e.g., 8h, 16h)
                  return hours % 1 === 0 ? `${hours}h` : `${hours.toFixed(1)}h`;
                } else {
                  // For days, show as decimal days (e.g., 1d, 1.5d, 2d)
                  const days = hours / 24;
                  return days % 1 === 0 ? `${days}d` : `${days.toFixed(1)}d`;
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
