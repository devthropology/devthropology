import { type MutableRefObject, useEffect, useMemo, useRef } from "react";
import Chart from "chart.js/auto";
import type { ChartType, TooltipModel } from "chart.js";
import {
  AI_PR_SIZE_BUCKETS,
  type TrendsPrSizeBucket,
  type TrendsPrSizeMonthlyPoint,
} from "../../../../shared/models/trendsInsights";
import { getBufferedBounds, getNiceStepSize } from "./chartScale";
import { ensureTooltipElement, positionTooltipElement } from "./lineChartTooltip";
import { PR_SIZE_BUCKET_SHORT_LABELS, SIZE_BUCKET_COLORS } from "./prSizeBuckets";
import type { PrSizeMixValueMode } from "./PrSizeMixPivotTable";

type Props = {
  points: TrendsPrSizeMonthlyPoint[];
  selectedYears: number[];
  valueMode: PrSizeMixValueMode;
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

function getMonthYearPoints(points: TrendsPrSizeMonthlyPoint[], month: number, year: number) {
  return points
    .filter((point) => point.month === month && point.year === year)
    .sort(
      (a, b) => AI_PR_SIZE_BUCKETS.indexOf(a.sizeBucket) - AI_PR_SIZE_BUCKETS.indexOf(b.sizeBucket),
    );
}

function getMonthYearValue(
  points: TrendsPrSizeMonthlyPoint[],
  month: number,
  year: number,
  bucket: TrendsPrSizeBucket,
  valueMode: PrSizeMixValueMode,
) {
  const point = points.find(
    (entry) => entry.year === year && entry.month === month && entry.sizeBucket === bucket,
  );

  if (!point) {
    return 0;
  }

  return valueMode === "count" ? point.prs : point.pctOfMonthPrs;
}

function getCountDeltaText(currentValue: number | null, previousValue: number | null) {
  if (currentValue === null || previousValue === null || previousValue === 0) {
    return null;
  }

  const delta = ((currentValue - previousValue) / previousValue) * 100;
  if (Math.abs(delta) < 0.05) {
    return "0.0%";
  }

  return `${delta > 0 ? "↑" : "↓"} ${Math.abs(delta).toFixed(1)}%`;
}

function getMixDeltaText(currentValue: number | null, previousValue: number | null) {
  if (currentValue === null || previousValue === null) {
    return null;
  }

  const delta = currentValue - previousValue;
  if (Math.abs(delta) < 0.05) {
    return "0.0 pp";
  }

  return `${delta > 0 ? "↑" : "↓"} ${Math.abs(delta).toFixed(1)} pp`;
}

export function getPrSizeMixTrendColor(bucket: TrendsPrSizeBucket, delta: number) {
  if (Math.abs(delta) < 0.05) {
    return "rgba(226, 232, 240, 0.92)";
  }

  if (bucket === "Micro (0-10)") {
    return "#9ca3af";
  }

  if (bucket === "Small (11-75)" || bucket === "Medium (76-250)") {
    return delta > 0 ? "#4ade80" : "#f87171";
  }

  return delta < 0 ? "#4ade80" : "#f87171";
}

function formatTrend(
  bucket: TrendsPrSizeBucket,
  currentValue: number | null,
  previousValue: number | null,
  valueMode: PrSizeMixValueMode,
) {
  if (currentValue === null || previousValue === null) {
    return { text: "-", color: "rgba(226, 232, 240, 0.72)" };
  }

  const delta =
    valueMode === "count" && previousValue !== 0
      ? ((currentValue - previousValue) / previousValue) * 100
      : currentValue - previousValue;
  if (Math.abs(delta) < 0.05) {
    return {
      text: valueMode === "count" ? "0.0%" : "0.0 pp",
      color: "rgba(226, 232, 240, 0.92)",
    };
  }

  return {
    text:
      valueMode === "count"
        ? (getCountDeltaText(currentValue, previousValue) ?? "-")
        : (getMixDeltaText(currentValue, previousValue) ?? "-"),
    color: getPrSizeMixTrendColor(bucket, delta),
  };
}

function appendYearValueCell({
  bucket,
  row,
  value,
  previousValue,
  valueMode,
}: {
  bucket: TrendsPrSizeBucket;
  row: HTMLTableRowElement;
  value: number | null;
  previousValue: number | null;
  valueMode: PrSizeMixValueMode;
}) {
  const valueCell = document.createElement("td");
  valueCell.className = "border-b border-white/10 px-4 py-3 text-right text-sm text-white/90";

  const cellContent = document.createElement("div");
  cellContent.className = "flex items-baseline justify-end gap-2 whitespace-nowrap";

  const valueLine = document.createElement("div");
  valueLine.textContent =
    value === null ? "-" : valueMode === "count" ? value.toLocaleString() : `${value.toFixed(1)}%`;
  cellContent.appendChild(valueLine);

  if (value !== null && previousValue !== null) {
    const trend = formatTrend(bucket, value, previousValue, valueMode);
    const deltaLine = document.createElement("div");
    deltaLine.className = "text-xs font-medium";
    deltaLine.style.color = trend.color;
    deltaLine.textContent = `(${trend.text})`;
    cellContent.appendChild(deltaLine);
  }

  valueCell.appendChild(cellContent);
  row.appendChild(valueCell);
}

function renderComparisonTooltip({
  chart,
  tooltip,
  tooltipRef,
  monthLabel,
  monthPointsByYear,
  sortedYears,
  valueMode,
}: {
  chart: { canvas: HTMLCanvasElement };
  tooltip: TooltipModel<ChartType>;
  tooltipRef: MutableRefObject<HTMLDivElement | null>;
  monthLabel: string;
  monthPointsByYear: Map<number, TrendsPrSizeMonthlyPoint[]>;
  sortedYears: number[];
  valueMode: PrSizeMixValueMode;
}) {
  const parent = chart.canvas.parentNode as HTMLElement | null;
  if (!parent) {
    return;
  }

  const tooltipEl = ensureTooltipElement(parent, tooltipRef);
  const content = tooltipEl.querySelector<HTMLDivElement>("[data-role='tooltip-content']");
  if (!content) {
    return;
  }

  if (tooltip.opacity === 0 || sortedYears.length === 0) {
    tooltipEl.style.opacity = "0";
    return;
  }

  content.replaceChildren();

  const title = document.createElement("div");
  title.className = "text-sm font-semibold text-white";
  title.textContent = `${monthLabel}: Mix`;
  content.appendChild(title);

  const table = document.createElement("table");
  table.className = "w-full border-collapse text-xs";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  const monthHeader = document.createElement("th");
  monthHeader.className =
    "border-b border-white/10 px-0 py-2 text-left text-sm font-semibold text-white";
  monthHeader.textContent = "Size Bucket";
  headerRow.appendChild(monthHeader);

  sortedYears.forEach((year) => {
    const yearHeader = document.createElement("th");
    yearHeader.className =
      "border-b border-white/10 px-4 py-2 text-right text-sm font-semibold text-white";
    yearHeader.textContent = String(year);
    headerRow.appendChild(yearHeader);
  });

  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  AI_PR_SIZE_BUCKETS.forEach((bucket) => {
    const row = document.createElement("tr");

    const bucketCell = document.createElement("td");
    bucketCell.className =
      "border-b border-white/10 px-0 py-3 text-left text-sm font-medium text-white";
    bucketCell.textContent = PR_SIZE_BUCKET_SHORT_LABELS[bucket];
    bucketCell.style.color = SIZE_BUCKET_COLORS[bucket];
    bucketCell.title = bucket;
    row.appendChild(bucketCell);

    let previousValue: number | null = null;

    sortedYears.forEach((year) => {
      const value =
        monthPointsByYear.get(year)?.find((point) => point.sizeBucket === bucket)?.[
          valueMode === "count" ? "prs" : "pctOfMonthPrs"
        ] ?? null;
      appendYearValueCell({ bucket, row, value, previousValue, valueMode });
      previousValue = value;
    });

    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  content.appendChild(table);

  tooltipEl.style.maxWidth = sortedYears.length >= 3 ? "640px" : "520px";
  tooltipEl.style.opacity = "1";

  const chartWithArea = chart as {
    chartArea?: { top: number; bottom: number };
  };
  const centeredCaretY = chartWithArea.chartArea
    ? chartWithArea.chartArea.top +
      (chartWithArea.chartArea.bottom - chartWithArea.chartArea.top) / 2
    : tooltip.caretY;

  positionTooltipElement({ chart, tooltip, tooltipEl, caretY: centeredCaretY });
}

export function PrSizeMixComparisonChart({ points, selectedYears, valueMode }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const sortedYears = useMemo(() => [...selectedYears].sort((a, b) => a - b), [selectedYears]);

  const datasets = useMemo(() => {
    const groupedBarWidth =
      sortedYears.length === 1 ? 0.58 : sortedYears.length === 2 ? 0.66 : 0.72;
    const perBarWidth = sortedYears.length === 1 ? 0.94 : sortedYears.length === 2 ? 0.9 : 0.86;

    return sortedYears.flatMap((year) =>
      AI_PR_SIZE_BUCKETS.map((sizeBucket) => ({
        label: `${year} ${sizeBucket}`,
        stack: String(year),
        year,
        sizeBucket,
        data: MONTH_LABELS.map((_, monthIndex) => {
          const point = points.find(
            (entry) =>
              entry.year === year &&
              entry.month === monthIndex + 1 &&
              entry.sizeBucket === sizeBucket,
          );

          return valueMode === "count" ? (point?.prs ?? 0) : (point?.pctOfMonthPrs ?? 0);
        }),
        backgroundColor: SIZE_BUCKET_COLORS[sizeBucket],
        borderColor: "rgba(15, 23, 42, 0.9)",
        borderWidth: 1,
        borderSkipped: false,
        categoryPercentage: groupedBarWidth,
        barPercentage: perBarWidth,
      })),
    );
  }, [points, sortedYears, valueMode]);

  const yAxisBounds = useMemo(() => {
    if (valueMode === "mix") {
      return { min: 0, max: 100, stepSize: 20 };
    }

    const totals = sortedYears.flatMap((year) =>
      MONTH_LABELS.map((_, monthIndex) =>
        AI_PR_SIZE_BUCKETS.reduce(
          (sum, bucket) => sum + getMonthYearValue(points, monthIndex + 1, year, bucket, "count"),
          0,
        ),
      ),
    );

    const maxValue = Math.max(0, ...totals);
    const stepSize = getNiceStepSize(maxValue || 1, maxValue || 1);
    return getBufferedBounds(0, maxValue, stepSize);
  }, [points, sortedYears, valueMode]);

  useEffect(() => {
    if (!canvasRef.current || sortedYears.length === 0) {
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
        labels: MONTH_LABELS,
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: {
          mode: "nearest",
          intersect: true,
        },
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            enabled: false,
            external: ({ chart, tooltip }) => {
              const monthIndex = tooltip.dataPoints?.[0]?.dataIndex;
              if (monthIndex === undefined) {
                if (tooltipRef.current) {
                  tooltipRef.current.style.opacity = "0";
                }
                return;
              }

              const monthNumber = monthIndex + 1;
              const monthPointsByYear = new Map(
                sortedYears.map((year) => [year, getMonthYearPoints(points, monthNumber, year)]),
              );

              renderComparisonTooltip({
                chart,
                tooltip,
                tooltipRef,
                monthLabel: MONTH_LABELS[monthIndex] ?? "",
                monthPointsByYear,
                sortedYears,
                valueMode,
              });
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            offset: true,
            ticks: {
              color: "rgba(255, 255, 255, 0.75)",
              padding: 12,
            },
            grid: {
              display: false,
            },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            min: yAxisBounds.min,
            max: yAxisBounds.max,
            ticks: {
              color: "rgba(255, 255, 255, 0.68)",
              stepSize: yAxisBounds.stepSize,
              callback: (value) =>
                valueMode === "count" ? Number(value).toLocaleString() : `${value}%`,
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
    points,
    sortedYears,
    valueMode,
    yAxisBounds.max,
    yAxisBounds.min,
    yAxisBounds.stepSize,
  ]);

  if (sortedYears.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        Pick one or more years to compare.
      </div>
    );
  }

  return (
    <div className="relative h-[336px] min-w-0">
      <canvas ref={canvasRef} />
    </div>
  );
}
