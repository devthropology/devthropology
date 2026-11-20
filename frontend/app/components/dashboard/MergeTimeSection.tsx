import * as React from "react";
import { CombinedMergeTimeUnit } from "./CombinedMergeTimeUnit";

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

export function MergeTimeSection({ current7d, current30d, weeklyTrends }: Props) {
  return (
    <CombinedMergeTimeUnit
      current7d={current7d}
      current30d={current30d}
      weeklyTrends={weeklyTrends}
    />
  );
}
