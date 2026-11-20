import * as React from "react";
import { MetricUnit } from "./MetricUnit";
import { WeeklyMergeTimesChart } from "./WeeklyMergeTimesChart";

interface VolumeSnapshot {
  prsMerged: number;
  prsMergedChangePercent: number | null;
  linesAdded: number;
  linesAddedChangePercent: number | null;
  linesDeleted: number;
  linesDeletedChangePercent: number | null;
  filesChanged: number;
  filesChangedChangePercent: number | null;
  avgTimeToMergeHours: number | null;
  avgTimeToMergeHoursChangePercent: number | null;
  medianTimeToMergeHours: number | null;
  medianTimeToMergeHoursChangePercent: number | null;
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

// Format hours to a human-readable string
function formatHours(hours: number | null): string {
  if (hours === null) return "N/A";

  if (hours < 1) {
    const minutes = Math.round(hours * 60);
    return `${minutes}m`;
  } else if (hours < 24) {
    return `${hours.toFixed(1)}h`;
  } else {
    const days = Math.round(hours / 24);
    return `${days}d`;
  }
}

export function MergeTimeUnit({ current7d, current30d, weeklyTrends }: Props) {
  const stats = [
    {
      label: "Avg Time - Last 7 Days",
      value: formatHours(current7d.avgTimeToMergeHours),
      changePercent: current7d.avgTimeToMergeHoursChangePercent,
      period: "vs prior week",
    },
    {
      label: "Median Time - Last 7 Days",
      value: formatHours(current7d.medianTimeToMergeHours),
      changePercent: current7d.medianTimeToMergeHoursChangePercent,
      period: "vs prior week",
    },
    {
      label: "Avg Time - Last 30 Days",
      value: formatHours(current30d.avgTimeToMergeHours),
      changePercent: current30d.avgTimeToMergeHoursChangePercent,
      period: "vs prior month",
    },
    {
      label: "Median Time - Last 30 Days",
      value: formatHours(current30d.medianTimeToMergeHours),
      changePercent: current30d.medianTimeToMergeHoursChangePercent,
      period: "vs prior month",
    },
  ];

  return (
    <MetricUnit
      title="Time to Merge"
      stats={stats}
      chart={<WeeklyMergeTimesChart weeklyTrends={weeklyTrends} />}
    />
  );
}
