import * as React from "react";
import { ChartCard } from "./ChartCard";
import { WeeklyLinesChart } from "./WeeklyLinesChart";

interface VolumeSnapshot {
  prsMerged: number;
  prsMergedChangePercent: number | null;
  linesAdded: number;
  linesAddedChangePercent: number | null;
  linesDeleted: number;
  linesDeletedChangePercent: number | null;
  filesChanged: number;
  filesChangedChangePercent: number | null;
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
  current7d: VolumeSnapshot;
  current30d: VolumeSnapshot;
  weeklyTrends: WeeklyVolume[];
}

// Calculate prior value from current and change percent
function calculatePrior(current: number, changePercent: number | null): number | null {
  if (changePercent === null) return null;
  return current / (1 + changePercent / 100);
}

// Compact stat component showing total lines inline (no tooltip needed - self-explanatory)
function LinesValue({ total, added, deleted }: { total: number; added: number; deleted: number }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-white">{total.toLocaleString()}</span>
      <span className="hidden items-baseline gap-1 sm:inline-flex">
        <span className="text-gray-500">(</span>
        <span className="text-green-400">+{added.toLocaleString()}</span>
        <span className="text-gray-500">, </span>
        <span className="text-red-400">-{deleted.toLocaleString()}</span>
        <span className="text-gray-500">)</span>
      </span>
    </span>
  );
}

export function LinesChangedUnit({ current7d, current30d, weeklyTrends }: Props) {
  // Build tooltip content for 7-day stats
  const total7d = current7d.linesAdded + current7d.linesDeleted;
  const priorTotal7d = calculatePrior(total7d, current7d.linesAddedChangePercent);

  const deltaTooltip7d =
    priorTotal7d !== null && current7d.linesAddedChangePercent !== null
      ? `Previous 7 days: ${Math.round(priorTotal7d).toLocaleString()} lines\nChange: ${current7d.linesAddedChangePercent >= 0 ? "+" : ""}${Math.round(current7d.linesAddedChangePercent)}%`
      : undefined;

  // Build tooltip content for 30-day stats
  const total30d = current30d.linesAdded + current30d.linesDeleted;
  const priorTotal30d = calculatePrior(total30d, current30d.linesAddedChangePercent);

  const deltaTooltip30d =
    priorTotal30d !== null && current30d.linesAddedChangePercent !== null
      ? `Previous 30 days: ${Math.round(priorTotal30d).toLocaleString()} lines\nChange: ${current30d.linesAddedChangePercent >= 0 ? "+" : ""}${Math.round(current30d.linesAddedChangePercent)}%`
      : undefined;

  const stats = [
    {
      label: "Last 7 Days",
      value: (
        <LinesValue total={total7d} added={current7d.linesAdded} deleted={current7d.linesDeleted} />
      ),
      changePercent: current7d.linesAddedChangePercent,
      deltaTooltip: deltaTooltip7d,
    },
    {
      label: "Last 30 Days",
      value: (
        <LinesValue
          total={total30d}
          added={current30d.linesAdded}
          deleted={current30d.linesDeleted}
        />
      ),
      changePercent: current30d.linesAddedChangePercent,
      deltaTooltip: deltaTooltip30d,
    },
  ];

  return (
    <ChartCard
      title="Lines Changed"
      stats={stats}
      renderChart={(viewMode) => (
        <WeeklyLinesChart weeklyTrends={weeklyTrends} viewMode={viewMode} />
      )}
    />
  );
}
