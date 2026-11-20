import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Chart from "chart.js/auto";

interface WeeklyVolume {
  weekStartDate: string;
  avgContributorAgeDays: number | null;
  medianContributorAgeDays: number | null;
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

function formatAgeDays(days: number): string {
  if (days < 30) {
    return `${Math.round(days)}d`;
  }
  if (days < 365) {
    const months = Math.round(days / 30);
    return months >= 12 ? `${Math.round(months / 12)}y` : `${months}mo`;
  }
  const years = Math.round(days / 365);
  return `${years}y`;
}

function formatAgeDaysTooltip(days: number): string {
  if (days < 30) {
    return `${days.toFixed(1)} days`;
  }
  if (days < 365) {
    return `${(days / 30).toFixed(1)} months`;
  }
  return `${(days / 365).toFixed(1)} years`;
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

export function WeeklyContributorAgeChart({ weeklyTrends }: Props) {
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

    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    const avgData = weeklyTrends.map((week) => week.avgContributorAgeDays);
    const medianData = weeklyTrends.map((week) => week.medianContributorAgeDays);

    const allValues = [...medianData, ...avgData].filter((v) => v !== null) as number[];
    const maxValue = Math.max(...allValues, 0);

    let suggestedStepSize: number | undefined;
    let suggestedMax: number | undefined;
    if (maxValue < 90) {
      suggestedStepSize = 15; // 15-day increments
    } else if (maxValue < 365) {
      suggestedStepSize = 30; // monthly increments
    } else {
      suggestedStepSize = 365; // yearly increments
    }
    if (suggestedStepSize && maxValue > 0) {
      suggestedMax = Math.ceil(maxValue / suggestedStepSize) * suggestedStepSize;
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
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: "rgb(59, 130, 246)",
            spanGaps: true,
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
            labels: {
              color: "white",
              usePointStyle: true,
              padding: 20,
            },
            position: "top",
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
                if (value === null) return `${context.dataset.label}: N/A`;
                return `${context.dataset.label}: ${formatAgeDaysTooltip(value)}`;
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
                return formatAgeDays(Number(value));
              },
            },
            suggestedMax,
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

  const hasAgeData = weeklyTrends.some(
    (week) => week.avgContributorAgeDays !== null || week.medianContributorAgeDays !== null,
  );

  if (!hasAgeData) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        No author age data available for merged PRs
      </div>
    );
  }

  return (
    <div className="relative h-64 w-full">
      <canvas ref={canvasRef} />
    </div>
  );
}
