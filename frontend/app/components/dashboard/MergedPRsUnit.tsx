import * as React from "react";
import { ChartCard } from "./ChartCard";
import { WeeklyPRTrendsChart } from "./WeeklyPRTrendsChart";

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
  ageBuckets?: Array<{ key: string; title: string; range: string; count: number }>;
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
  // changePercent = ((current - prior) / prior) * 100
  // Solving for prior: prior = current / (1 + changePercent/100)
  return current / (1 + changePercent / 100);
}

export function MergedPRsUnit({ current7d, current30d, weeklyTrends }: Props) {
  const prior7d = calculatePrior(current7d.prsMerged, current7d.prsMergedChangePercent);
  const prior30d = calculatePrior(current30d.prsMerged, current30d.prsMergedChangePercent);

  const deltaTooltip7d =
    prior7d !== null && current7d.prsMergedChangePercent !== null
      ? `Previous 7 days: ${Math.round(prior7d).toLocaleString()} merged PRs\nChange: ${current7d.prsMergedChangePercent >= 0 ? "+" : ""}${Math.round(current7d.prsMergedChangePercent)}%`
      : undefined;

  const deltaTooltip30d =
    prior30d !== null && current30d.prsMergedChangePercent !== null
      ? `Previous 30 days: ${Math.round(prior30d).toLocaleString()} merged PRs\nChange: ${current30d.prsMergedChangePercent >= 0 ? "+" : ""}${Math.round(current30d.prsMergedChangePercent)}%`
      : undefined;

  const stats = [
    {
      label: "Last 7 Days",
      value: current7d.prsMerged,
      changePercent: current7d.prsMergedChangePercent,
      period: "vs prior week",
      deltaTooltip: deltaTooltip7d,
    },
    {
      label: "Last 30 Days",
      value: current30d.prsMerged,
      changePercent: current30d.prsMergedChangePercent,
      period: "vs prior month",
      deltaTooltip: deltaTooltip30d,
    },
  ];

  return (
    <ChartCard
      title="Merged PRs"
      stats={stats}
      renderChart={(viewMode) => (
        <WeeklyPRTrendsChart weeklyTrends={weeklyTrends} viewMode={viewMode} />
      )}
    />
  );
}
