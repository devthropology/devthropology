import * as React from "react";
import { useEffect, useRef } from "react";
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

export function WeeklyAvgMergeTimesChart({ weeklyTrends }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !weeklyTrends.length) return;

    // Cleanup existing chart
    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    // Format week labels (e.g. "Jul 21" for July 21st week start)
    const labels = weeklyTrends.map((week) => {
      const date = new Date(week.weekStartDate);
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
    });

    // Filter out null values and create data arrays
    const avgData = weeklyTrends.map((week) => week.avgTimeToMergeHours);

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
            display: false, // Hide legend since there's only one line
          },
          tooltip: {
            callbacks: {
              label: function (context) {
                const value = context.parsed.y;
                if (value === null) return "Average Time: N/A";

                // Format with detailed units for tooltip
                let detailedValue;
                if (value < 1) {
                  const minutes = Math.round(value * 60);
                  detailedValue = `${minutes} minutes`;
                } else if (value < 24) {
                  detailedValue = `${value.toFixed(1)} hours`;
                } else {
                  const days = value / 24;
                  detailedValue = `${days.toFixed(1)} days (${value.toFixed(1)} hours)`;
                }
                return `Average Time: ${detailedValue}`;
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
              maxTicksLimit: 8, // Show ~8 weeks to avoid crowding
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
                if (hours === 0) {
                  return "0h";
                } else if (hours < 1) {
                  return `${Math.round(hours * 60)}m`;
                } else if (hours < 24) {
                  return `${hours.toFixed(1)}h`;
                } else {
                  const days = hours / 24;
                  return `${days.toFixed(1)}d`;
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
  }, [weeklyTrends]);

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
  const hasTimingData = weeklyTrends.some((week) => week.avgTimeToMergeHours !== null);

  if (!hasTimingData) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        No average timing data available for merged PRs
      </div>
    );
  }

  return (
    <div className="relative h-64 w-full">
      <canvas ref={canvasRef} />
    </div>
  );
}
