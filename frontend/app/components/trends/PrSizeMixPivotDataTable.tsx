import { useMemo } from "react";
import type { DataTableColumnDef as ColumnDef } from "../ui/data-table-features";
import type { TrendsPrSizeMonthlyPoint } from "../../../../shared/models/trendsInsights";
import { AI_PR_SIZE_BUCKETS } from "../../../../shared/models/trendsInsights";
import { DataTable } from "~/components/ui/data-table";
import { cn } from "~/lib/utils";
import {
  buildPrSizeMixPivotRows,
  getPrSizeMixPivotCell,
  type PrSizeMixComparisonMode,
  type PrSizeMixPivotRow,
  type PrSizeMixValueMode,
} from "./PrSizeMixPivotTable";
import {
  CONTRIBUTION_FLOW_TABLE_APPEARANCE,
  CONTRIBUTION_FLOW_TABLE_SURFACE,
} from "./trendsTableAppearance";
import { PR_SIZE_BUCKET_SHORT_LABELS, SIZE_BUCKET_COLORS } from "./prSizeBuckets";

type Props = {
  points: TrendsPrSizeMonthlyPoint[];
  selectedYears: number[];
  valueMode: PrSizeMixValueMode;
  comparisonMode: PrSizeMixComparisonMode;
};

function getComparisonKey(row: PrSizeMixPivotRow, mode: PrSizeMixComparisonMode) {
  if (mode === "sameMonthLastYear") {
    return `${row.year - 1}-${row.month}`;
  }

  const previousMonth = row.month === 1 ? 12 : row.month - 1;
  const previousYear = row.month === 1 ? row.year - 1 : row.year;
  return `${previousYear}-${previousMonth}`;
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
    <div className={cn("flex flex-col items-end gap-0.5 text-right whitespace-nowrap", className)}>
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
  comparisonMode: PrSizeMixComparisonMode,
  valueMode: PrSizeMixValueMode,
  rowsByKey: Map<string, PrSizeMixPivotRow>,
): ColumnDef<PrSizeMixPivotRow>[] {
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
      accessorFn: (row: PrSizeMixPivotRow) => row.counts[bucket],
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
      cell: ({ row }: { row: { original: PrSizeMixPivotRow } }) => {
        const comparisonRow = rowsByKey.get(getComparisonKey(row.original, comparisonMode)) ?? null;
        const cell = getPrSizeMixPivotCell(row.original, comparisonRow, bucket, valueMode);

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

export function PrSizeMixPivotDataTable({
  points,
  selectedYears,
  valueMode,
  comparisonMode,
}: Props) {
  const rows = useMemo(
    () => buildPrSizeMixPivotRows(points, selectedYears),
    [points, selectedYears],
  );
  const rowsByKey = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows]);
  const columns = useMemo(
    () => createColumns(comparisonMode, valueMode, rowsByKey),
    [comparisonMode, rowsByKey, valueMode],
  );

  if (rows.length === 0) {
    return (
      <div className="flex h-full min-h-[368px] items-center justify-center rounded-lg bg-white/5 p-4 text-sm text-gray-400">
        No PR size mix history yet
      </div>
    );
  }

  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-lg bg-white/5 ring-1 ring-inset ring-white/10 [&>div]:border-0 [&>div]:rounded-none",
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
