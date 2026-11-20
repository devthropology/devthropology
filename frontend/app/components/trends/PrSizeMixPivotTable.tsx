import { useMemo } from "react";
import type {
  TrendsPrSizeBucket,
  TrendsPrSizeMonthlyPoint,
} from "../../../../shared/models/trendsInsights";
import { AI_PR_SIZE_BUCKETS } from "../../../../shared/models/trendsInsights";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { getPrSizeMixTrendColor } from "./PrSizeMixComparisonChart";
import { SIZE_BUCKET_COLORS } from "./prSizeBuckets";

type Props = {
  points: TrendsPrSizeMonthlyPoint[];
  selectedYears: number[];
  valueMode: PrSizeMixValueMode;
  comparisonMode: PrSizeMixComparisonMode;
};

export type PrSizeMixValueMode = "mix" | "count";
export type PrSizeMixComparisonMode = "priorMonth" | "sameMonthLastYear";

export type PrSizeMixPivotRow = {
  key: string;
  month: number;
  year: number;
  label: string;
  totalCount: number;
  counts: Record<TrendsPrSizeBucket, number>;
};

export type PrSizeMixPivotCell = {
  mainValue: string;
  deltaText: string | null;
  deltaColor: string | null;
};

const BUCKET_SHORT_LABELS: Record<TrendsPrSizeBucket, string> = {
  "Micro (0-10)": "Micro",
  "Small (11-75)": "Small",
  "Medium (76-250)": "Medium",
  "Large (251-500)": "Large",
  "XL (501-1000)": "XL",
  "Oversized (1000+)": "Oversized",
};

function formatMonthName(month: number) {
  return new Date(Date.UTC(2024, month - 1, 1)).toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
}

function getEmptyCounts() {
  return Object.fromEntries(AI_PR_SIZE_BUCKETS.map((bucket) => [bucket, 0])) as Record<
    TrendsPrSizeBucket,
    number
  >;
}

export function buildPrSizeMixPivotRows(
  points: TrendsPrSizeMonthlyPoint[],
  selectedYears: number[],
): PrSizeMixPivotRow[] {
  const yearSet = new Set(selectedYears);
  const grouped = new Map<string, PrSizeMixPivotRow>();

  points.forEach((point) => {
    if (!yearSet.has(point.year)) {
      return;
    }

    const key = `${point.year}-${point.month}`;
    const existing = grouped.get(key) ?? {
      key,
      month: point.month,
      year: point.year,
      label: `${formatMonthName(point.month)} ${point.year}`,
      totalCount: 0,
      counts: getEmptyCounts(),
    };

    existing.counts[point.sizeBucket] = point.prs;
    existing.totalCount += point.prs;
    grouped.set(key, existing);
  });

  return [...grouped.values()].sort((a, b) => b.year - a.year || b.month - a.month);
}

function getComparisonKey(row: PrSizeMixPivotRow, mode: PrSizeMixComparisonMode) {
  if (mode === "sameMonthLastYear") {
    return `${row.year - 1}-${row.month}`;
  }

  const previousMonth = row.month === 1 ? 12 : row.month - 1;
  const previousYear = row.month === 1 ? row.year - 1 : row.year;
  return `${previousYear}-${previousMonth}`;
}

function formatSignedDelta(value: number, suffix: string) {
  const absValue = Math.abs(value).toFixed(1);
  return `${value >= 0 ? "↑" : "↓"} ${absValue}${suffix}`;
}

export function getPrSizeMixPivotCell(
  row: PrSizeMixPivotRow,
  comparisonRow: PrSizeMixPivotRow | null,
  bucket: TrendsPrSizeBucket,
  valueMode: PrSizeMixValueMode,
): PrSizeMixPivotCell {
  const currentCount = row.counts[bucket] ?? 0;

  if (valueMode === "count") {
    const mainValue = currentCount.toLocaleString();
    const comparisonCount = comparisonRow?.counts[bucket] ?? null;

    if (comparisonCount === null || comparisonCount === 0) {
      return { mainValue, deltaText: null, deltaColor: null };
    }

    const deltaPercent = ((currentCount - comparisonCount) / comparisonCount) * 100;
    return {
      mainValue,
      deltaText: `(${formatSignedDelta(deltaPercent, "%")})`,
      deltaColor: getPrSizeMixTrendColor(bucket, deltaPercent),
    };
  }

  const currentPct = row.totalCount > 0 ? (currentCount / row.totalCount) * 100 : 0;
  const mainValue = `${currentPct.toFixed(1)}%`;

  if (!comparisonRow || comparisonRow.totalCount === 0) {
    return { mainValue, deltaText: null, deltaColor: null };
  }

  const comparisonPct = (comparisonRow.counts[bucket] / comparisonRow.totalCount) * 100;
  const deltaPoints = currentPct - comparisonPct;

  return {
    mainValue,
    deltaText: `(${formatSignedDelta(deltaPoints, " pp")})`,
    deltaColor: getPrSizeMixTrendColor(bucket, deltaPoints),
  };
}
export function PrSizeMixPivotControlGroup({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="flex w-fit flex-nowrap gap-1 rounded-lg bg-white/5 p-1">
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            "border-transparent bg-transparent text-gray-400 shadow-none hover:bg-white/5 hover:text-white",
            value === option.value && "bg-white/10 text-white",
          )}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

export function PrSizeMixPivotTable({ points, selectedYears, valueMode, comparisonMode }: Props) {
  const rows = useMemo(
    () => buildPrSizeMixPivotRows(points, selectedYears),
    [points, selectedYears],
  );

  const rowsByKey = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows]);

  if (rows.length === 0) {
    return (
      <div className="flex h-full min-h-[360px] items-center justify-center rounded-lg bg-white/5 p-4 text-sm text-gray-400">
        No PR size mix history yet
      </div>
    );
  }

  return (
    <div className="flex h-[392px] min-w-0 flex-col rounded-lg bg-white/5 p-3">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-[700px] border-collapse text-sm">
          <thead className="sticky top-0 bg-[rgba(51,58,74,0.96)] backdrop-blur-sm">
            <tr>
              <th className="border-b border-white/10 px-0 py-2 text-left font-semibold text-white">
                Month
              </th>
              {AI_PR_SIZE_BUCKETS.map((bucket) => (
                <th
                  key={bucket}
                  className="border-b border-white/10 px-4 py-2 text-right font-semibold"
                  style={{ color: SIZE_BUCKET_COLORS[bucket] }}
                  title={bucket}
                >
                  {BUCKET_SHORT_LABELS[bucket]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const comparisonRow = rowsByKey.get(getComparisonKey(row, comparisonMode)) ?? null;

              return (
                <tr key={row.key}>
                  <td className="border-b border-white/10 px-0 py-3 text-left font-medium text-white">
                    {row.label}
                  </td>
                  {AI_PR_SIZE_BUCKETS.map((bucket) => {
                    const cell = getPrSizeMixPivotCell(row, comparisonRow, bucket, valueMode);

                    return (
                      <td
                        key={`${row.key}-${bucket}`}
                        className="border-b border-white/10 px-4 py-3 text-right"
                      >
                        <div className="flex flex-col items-end gap-0.5 whitespace-nowrap">
                          <div className="text-sm font-medium text-white">{cell.mainValue}</div>
                          {cell.deltaText ? (
                            <div
                              className="text-xs font-medium"
                              style={{ color: cell.deltaColor ?? undefined }}
                            >
                              {cell.deltaText}
                            </div>
                          ) : null}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
