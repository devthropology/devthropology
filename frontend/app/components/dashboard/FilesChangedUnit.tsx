import * as React from "react";
import { ChartCard } from "./ChartCard";
import { WeeklyFilesChart } from "./WeeklyFilesChart";

interface VolumeSnapshot {
  prsMerged: number;
  prsMergedChangePercent: number | null;
  linesAdded: number;
  linesAddedChangePercent: number | null;
  linesDeleted: number;
  linesDeletedChangePercent: number | null;
  filesChanged: number;
  filesChangedChangePercent: number | null;
  filesAdded: number;
  filesModified: number;
  filesRemoved: number;
  filesRenamed: number;
}

interface WeeklyVolume {
  weekStartDate: string;
  prsMerged: number;
  linesAdded: number;
  linesDeleted: number;
  filesChanged: number;
  filesAdded: number;
  filesModified: number;
  filesRemoved: number;
  filesRenamed: number;
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

export function FilesChangedUnit({ current7d, current30d, weeklyTrends }: Props) {
  // Build tooltip content for 7-day stats
  const priorFiles7d = calculatePrior(current7d.filesChanged, current7d.filesChangedChangePercent);

  const deltaTooltip7d =
    priorFiles7d !== null && current7d.filesChangedChangePercent !== null
      ? `Previous 7 days: ${Math.round(priorFiles7d).toLocaleString()} files\nChange: ${current7d.filesChangedChangePercent >= 0 ? "+" : ""}${Math.round(current7d.filesChangedChangePercent)}%`
      : undefined;

  // Build tooltip content for 30-day stats
  const priorFiles30d = calculatePrior(
    current30d.filesChanged,
    current30d.filesChangedChangePercent,
  );

  const deltaTooltip30d =
    priorFiles30d !== null && current30d.filesChangedChangePercent !== null
      ? `Previous 30 days: ${Math.round(priorFiles30d).toLocaleString()} files\nChange: ${current30d.filesChangedChangePercent >= 0 ? "+" : ""}${Math.round(current30d.filesChangedChangePercent)}%`
      : undefined;

  const stats = [
    {
      label: "Last 7 Days",
      value: current7d.filesChanged,
      changePercent: current7d.filesChangedChangePercent,
      deltaTooltip: deltaTooltip7d,
    },
    {
      label: "Last 30 Days",
      value: current30d.filesChanged,
      changePercent: current30d.filesChangedChangePercent,
      deltaTooltip: deltaTooltip30d,
    },
  ];

  return (
    <ChartCard
      title="Files Changed"
      stats={stats}
      renderChart={(viewMode) => (
        <WeeklyFilesChart weeklyTrends={weeklyTrends} viewMode={viewMode} />
      )}
    />
  );
}
