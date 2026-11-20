import { useEffect, useMemo, useRef } from "react";
import Chart from "chart.js/auto";
import type { UserMetricKey } from "../../../../shared/models";

interface UserMonthlyMetrics {
  months: string[];
  prsMerged: number[];
  linesModified: number[];
  prsReviewed: number[];
  prCommentsAdded: number[];
}

interface Props {
  data: UserMonthlyMetrics | null;
  selectedMetric: UserMetricKey;
  isLoading: boolean;
}

const METRIC_CONFIG: Record<
  UserMetricKey,
  { label: string; color: string; dataKey: keyof UserMonthlyMetrics }
> = {
  prs_merged: {
    label: "Merged PRs",
    color: "#60A5FA",
    dataKey: "prsMerged",
  },
  lines_modified: {
    label: "Lines Modified",
    color: "#34D399",
    dataKey: "linesModified",
  },
  prs_reviewed: {
    label: "PRs Reviewed",
    color: "#A78BFA",
    dataKey: "prsReviewed",
  },
  pr_comments_added: {
    label: "PR Comments",
    color: "#FBBF24",
    dataKey: "prCommentsAdded",
  },
};

function formatMonthLabel(month: string): string {
  // month is "2024-01" format
  const [year, m] = month.split("-");
  const monthNames = [
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
  const monthIndex = parseInt(m, 10) - 1;
  const shortYear = year.slice(2);
  return `${monthNames[monthIndex]} '${shortYear}`;
}

export function UserMonthlyMetricsChart({ data, selectedMetric, isLoading }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  const config = METRIC_CONFIG[selectedMetric];

  const labels = useMemo(() => {
    if (!data) return [];
    return data.months.map(formatMonthLabel);
  }, [data]);

  const values = useMemo(() => {
    if (!data) return [];
    return data[config.dataKey] as number[];
  }, [data, config.dataKey]);

  useEffect(() => {
    if (!canvasRef.current || !data || !values.length) {
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
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: config.label,
            data: values,
            backgroundColor: config.color,
            borderColor: config.color,
            borderWidth: 1,
            borderRadius: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            callbacks: {
              title: (items) => {
                if (!items.length || !data) return "";
                const index = items[0].dataIndex;
                const month = data.months[index];
                const [year, m] = month.split("-");
                const monthNames = [
                  "January",
                  "February",
                  "March",
                  "April",
                  "May",
                  "June",
                  "July",
                  "August",
                  "September",
                  "October",
                  "November",
                  "December",
                ];
                return `${monthNames[parseInt(m, 10) - 1]} ${year}`;
              },
              label: (context) => {
                const value = context.parsed.y ?? 0;
                return `${config.label}: ${value.toLocaleString()}`;
              },
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: "rgba(255, 255, 255, 0.7)",
              maxRotation: 45,
              minRotation: 0,
              autoSkip: true,
              maxTicksLimit: 12,
              font: { size: 10 },
            },
            grid: {
              color: "rgba(255, 255, 255, 0.06)",
            },
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: "rgba(255, 255, 255, 0.7)",
              font: { size: 10 },
              precision: 0,
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
  }, [data, selectedMetric, labels, values, config]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
      }
    };
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <div className="flex flex-col items-center gap-2">
          <svg
            className="animate-spin h-6 w-6 text-gray-400"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span className="text-sm">Loading monthly data...</span>
        </div>
      </div>
    );
  }

  if (!data || !values.length) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <span className="text-sm">No monthly data available</span>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <canvas ref={canvasRef} />
    </div>
  );
}
