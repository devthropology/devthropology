import { useMemo } from "react";
import type { DataTableColumnDef as ColumnDef } from "../ui/data-table-features";
import type {
  TrendsPrSizeBucket,
  TrendsPrSizeMonthlyPoint,
} from "../../../../shared/models/trendsInsights";
import { AI_PR_SIZE_BUCKETS } from "../../../../shared/models/trendsInsights";
import { DataTable } from "~/components/ui/data-table";
import { cn } from "~/lib/utils";
import {
  CONTRIBUTION_FLOW_TABLE_APPEARANCE,
  CONTRIBUTION_FLOW_TABLE_SURFACE,
} from "./trendsTableAppearance";
import type {
  ReviewTimingFamilyKey,
  ReviewTimingMetricKey,
} from "./PrReviewTimingSeasonalityChart";
import { PR_SIZE_BUCKET_SHORT_LABELS, SIZE_BUCKET_COLORS } from "./prSizeBuckets";
import type { SizeReviewMode, SizeReviewRoundsScopeKey } from "./PrReviewTimingBySizeChart";

export type ReviewTimingComparisonMode = "priorMonth" | "sameMonthLastYear";

type Props = {
  points: TrendsPrSizeMonthlyPoint[];
  mode: SizeReviewMode;
  timingMetric: ReviewTimingMetricKey;
  timingFamily: ReviewTimingFamilyKey;
  roundsScope: SizeReviewRoundsScopeKey;
  selectedYears: number[];
  comparisonMode: ReviewTimingComparisonMode;
};

type TimingBucketCell = {
  value: number | null;
  mainValue: string;
  deltaText: string | null;
  deltaColor: string | null;
};

type TimingPivotRow = {
  key: string;
  year: number;
  month: number;
  label: string;
  values: Record<TrendsPrSizeBucket, number | null>;
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
  family: ReviewTimingFamilyKey,
  metric: ReviewTimingMetricKey,
): keyof TrendsPrSizeMonthlyPoint {
  if (family === "review") {
    if (metric === "p50") return "p50TimeToFirstReviewHours";
    if (metric === "p75") return "p75TimeToFirstReviewHours";
    return "p90TimeToFirstReviewHours";
  }

  if (metric === "p50") return "p50TimeToEffectiveApprovalHours";
  if (metric === "p75") return "p75TimeToEffectiveApprovalHours";
  return "p90TimeToEffectiveApprovalHours";
}

function getRoundsMetricField(scope: SizeReviewRoundsScopeKey): keyof TrendsPrSizeMonthlyPoint {
  return scope === "all" ? "avgAllRounds" : "avgRounds";
}

function formatDurationHours(value: number | null) {
  if (value === null) {
    return "-";
  }
  if (value < 1) {
    return `${Math.round(value * 60)}m`;
  }
  if (value < 24) {
    return `${value.toFixed(value >= 10 ? 0 : 1)}h`;
  }
  const days = value / 24;
  return `${days.toFixed(days >= 10 ? 0 : 1)}d`;
}

function formatRoundsValue(value: number | null) {
  if (value === null) {
    return "-";
  }
  return value.toFixed(value % 1 === 0 ? 0 : value >= 10 ? 1 : 2);
}

function getDeltaText(currentValue: number | null, previousValue: number | null) {
  if (currentValue === null || previousValue === null || previousValue === 0) {
    return null;
  }

  const delta = ((currentValue - previousValue) / previousValue) * 100;
  if (Math.abs(delta) < 0.05) {
    return "(0.0%)";
  }

  return `(${delta > 0 ? "↑" : "↓"} ${Math.abs(delta).toFixed(1)}%)`;
}

function getDeltaColor(currentValue: number | null, previousValue: number | null) {
  if (currentValue === null || previousValue === null || previousValue === 0) {
    return null;
  }

  if (Math.abs(currentValue - previousValue) < 0.001) {
    return "rgba(226, 232, 240, 0.92)";
  }

  return currentValue > previousValue ? "#f87171" : "#4ade80";
}

function getComparisonKey(row: TimingPivotRow, mode: ReviewTimingComparisonMode) {
  if (mode === "sameMonthLastYear") {
    return `${row.year - 1}-${row.month}`;
  }

  const previousMonth = row.month === 1 ? 12 : row.month - 1;
  const previousYear = row.month === 1 ? row.year - 1 : row.year;
  return `${previousYear}-${previousMonth}`;
}

function buildRows(
  points: TrendsPrSizeMonthlyPoint[],
  selectedYears: number[],
  mode: SizeReviewMode,
  timingFamily: ReviewTimingFamilyKey,
  timingMetric: ReviewTimingMetricKey,
  roundsScope: SizeReviewRoundsScopeKey,
): TimingPivotRow[] {
  const selectedYearSet = new Set(selectedYears);
  const field =
    mode === "timing"
      ? getMetricField(timingFamily, timingMetric)
      : getRoundsMetricField(roundsScope);
  const grouped = new Map<string, TimingPivotRow>();

  points.forEach((point) => {
    if (!selectedYearSet.has(point.year)) {
      return;
    }

    const key = `${point.year}-${point.month}`;
    const existing = grouped.get(key) ?? {
      key,
      year: point.year,
      month: point.month,
      label: `${MONTH_LABELS[point.month - 1]} ${point.year}`,
      values: Object.fromEntries(AI_PR_SIZE_BUCKETS.map((bucket) => [bucket, null])) as Record<
        TrendsPrSizeBucket,
        number | null
      >,
    };

    const value = point[field];
    existing.values[point.sizeBucket] = typeof value === "number" ? value : null;
    grouped.set(key, existing);
  });

  return [...grouped.values()].sort((a, b) => b.year - a.year || b.month - a.month);
}

function getCell(
  row: TimingPivotRow,
  comparisonRow: TimingPivotRow | null,
  bucket: TrendsPrSizeBucket,
  mode: SizeReviewMode,
): TimingBucketCell {
  const value = row.values[bucket];
  const previousValue = comparisonRow?.values[bucket] ?? null;
  return {
    value,
    mainValue: mode === "timing" ? formatDurationHours(value) : formatRoundsValue(value),
    deltaText: getDeltaText(value, previousValue),
    deltaColor: getDeltaColor(value, previousValue),
  };
}

function BucketCell({
  mainValue,
  deltaText,
  deltaColor,
  className,
}: {
  mainValue: string;
  deltaText: string | null;
  deltaColor: string | null;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-end gap-0.5 whitespace-nowrap text-right", className)}>
      <div className="text-sm font-semibold text-slate-100">{mainValue}</div>
      {deltaText ? (
        <div
          className="text-[11px] font-medium opacity-90"
          style={{ color: deltaColor ?? undefined }}
        >
          {deltaText}
        </div>
      ) : null}
    </div>
  );
}

function createColumns(
  mode: SizeReviewMode,
  comparisonMode: ReviewTimingComparisonMode,
  rowsByKey: Map<string, TimingPivotRow>,
): ColumnDef<TimingPivotRow>[] {
  return [
    {
      accessorKey: "label",
      header: () => <span className="text-slate-50">Month</span>,
      cell: ({ row }) => (
        <div className="w-[68px] text-sm font-semibold text-slate-50">{row.original.label}</div>
      ),
      size: 92,
      minSize: 92,
      maxSize: 92,
      meta: {
        headerClassName: "px-3",
        cellClassName: "px-3",
      },
    },
    ...AI_PR_SIZE_BUCKETS.map((bucket) => ({
      id: bucket,
      accessorFn: (row: TimingPivotRow) => row.values[bucket],
      header: () => (
        <div
          className={cn(
            "text-right text-sm font-semibold",
            bucket === "Oversized (1000+)" && "pr-2",
          )}
          style={{ color: SIZE_BUCKET_COLORS[bucket] }}
        >
          {PR_SIZE_BUCKET_SHORT_LABELS[bucket]}
        </div>
      ),
      cell: ({ row }: { row: { original: TimingPivotRow } }) => {
        const comparisonRow = rowsByKey.get(getComparisonKey(row.original, comparisonMode)) ?? null;
        const cell = getCell(row.original, comparisonRow, bucket, mode);

        return (
          <BucketCell
            mainValue={cell.mainValue}
            deltaText={cell.deltaText}
            deltaColor={cell.deltaColor}
            className={bucket === "Oversized (1000+)" ? "pr-2" : undefined}
          />
        );
      },
      size: 88,
      minSize: 88,
    })),
  ];
}

export function PrReviewTimingBySizeTable({
  points,
  mode,
  timingMetric,
  timingFamily,
  roundsScope,
  selectedYears,
  comparisonMode,
}: Props) {
  const rows = useMemo(
    () => buildRows(points, selectedYears, mode, timingFamily, timingMetric, roundsScope),
    [mode, points, roundsScope, selectedYears, timingFamily, timingMetric],
  );
  const rowsByKey = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows]);
  const columns = useMemo(
    () => createColumns(mode, comparisonMode, rowsByKey),
    [comparisonMode, mode, rowsByKey],
  );

  if (rows.length === 0) {
    return (
      <div className="flex h-full min-h-[368px] items-center justify-center rounded-lg bg-white/5 p-4 text-sm text-gray-400">
        No size review history yet
      </div>
    );
  }

  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-lg bg-white/5 ring-1 ring-inset ring-white/10 [&>div]:rounded-none [&>div]:border-0",
      )}
    >
      <DataTable
        columns={columns}
        data={rows}
        pinnedColumn="label"
        maxHeight="368px"
        appearance={CONTRIBUTION_FLOW_TABLE_APPEARANCE}
        surface={CONTRIBUTION_FLOW_TABLE_SURFACE}
      />
    </div>
  );
}
