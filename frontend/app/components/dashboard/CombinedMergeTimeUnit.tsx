import * as React from "react";
import { MetricUnit } from "./MetricUnit";
import { WeeklyCombinedMergeTimesChart } from "./WeeklyCombinedMergeTimesChart";
import { SimpleTooltip } from "~/components/ui/SimpleTooltip";

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

// Smart formatting: normalizes units for easy comparison when both values are small
function formatHoursWithContext(
  hours: number | null,
  medianHours: number | null,
  avgHours: number | null,
): string {
  if (hours === null) return "N/A";

  // If both metrics are under 48 hours, show both in hours for easy comparison
  const bothUnder48h = (medianHours ?? 0) < 48 && (avgHours ?? 0) < 48;

  if (bothUnder48h) {
    // Show in hours with decimal for easy comparison (e.g., "14.2h" vs "43.2h")
    if (hours < 1) {
      const minutes = Math.round(hours * 60);
      return `${minutes}m`;
    }
    return `${hours.toFixed(1)}h`;
  }

  // Otherwise use natural units
  if (hours < 1) {
    const minutes = Math.round(hours * 60);
    return `${minutes}m`;
  } else if (hours < 24) {
    return `${hours.toFixed(1)}h`;
  } else {
    const days = hours / 24;
    return `${days.toFixed(1)}d`;
  }
}

// Compact stat component showing median and average side by side
// Includes its own tooltip explaining what the values mean
function CombinedStatValue({
  medianValue,
  avgValue,
  tooltip,
}: {
  medianValue: number | null;
  avgValue: number | null;
  tooltip: string;
}) {
  const medianFormatted = formatHoursWithContext(medianValue, medianValue, avgValue);
  const avgFormatted = formatHoursWithContext(avgValue, medianValue, avgValue);

  return (
    <SimpleTooltip content={tooltip}>
      <span className="inline-flex items-baseline gap-3">
        <span className="text-blue-400">{medianFormatted}</span>
        <span className="text-gray-500">/</span>
        <span className="text-purple-400">{avgFormatted}</span>
      </span>
    </SimpleTooltip>
  );
}

// Format hours for tooltip (always show full detail)
function formatHoursDetailed(hours: number | null): string {
  if (hours === null) return "N/A";
  if (hours < 1) {
    const minutes = Math.round(hours * 60);
    return `${minutes} minutes`;
  } else if (hours < 24) {
    return `${hours.toFixed(1)} hours`;
  } else {
    const days = hours / 24;
    return `${days.toFixed(1)} days`;
  }
}

// Calculate prior value from current and change percent
function calculatePrior(current: number | null, changePercent: number | null): number | null {
  if (current === null || changePercent === null) return null;
  // changePercent = ((current - prior) / prior) * 100
  // Solving for prior: prior = current / (1 + changePercent/100)
  return current / (1 + changePercent / 100);
}

export function CombinedMergeTimeUnit({ current7d, current30d, weeklyTrends }: Props) {
  // Build tooltip content for 7-day stats
  const median7d = current7d.medianTimeToMergeHours;
  const avg7d = current7d.avgTimeToMergeHours;
  const medianChange7d = current7d.medianTimeToMergeHoursChangePercent;
  const avgChange7d = current7d.avgTimeToMergeHoursChangePercent;
  const priorMedian7d = calculatePrior(median7d, medianChange7d);
  const priorAvg7d = calculatePrior(avg7d, avgChange7d);

  const valueTooltip7d = `Median: ${formatHoursDetailed(median7d)}\nAverage: ${formatHoursDetailed(avg7d)}\nWindow: last 7 days`;
  const deltaTooltip7d =
    medianChange7d !== null || avgChange7d !== null
      ? `${
          priorMedian7d !== null && medianChange7d !== null
            ? `Previous 7-day median: ${formatHoursDetailed(priorMedian7d)}\nChange: ${medianChange7d >= 0 ? "+" : ""}${Math.round(medianChange7d)}%`
            : ""
        }${
          priorAvg7d !== null && avgChange7d !== null
            ? `${priorMedian7d !== null && medianChange7d !== null ? "\n\n" : ""}Previous 7-day average: ${formatHoursDetailed(priorAvg7d)}\nChange: ${avgChange7d >= 0 ? "+" : ""}${Math.round(avgChange7d)}%`
            : ""
        }`
      : undefined;

  // Build tooltip content for 30-day stats
  const median30d = current30d.medianTimeToMergeHours;
  const avg30d = current30d.avgTimeToMergeHours;
  const medianChange30d = current30d.medianTimeToMergeHoursChangePercent;
  const avgChange30d = current30d.avgTimeToMergeHoursChangePercent;
  const priorMedian30d = calculatePrior(median30d, medianChange30d);
  const priorAvg30d = calculatePrior(avg30d, avgChange30d);

  const valueTooltip30d = `Median: ${formatHoursDetailed(median30d)}\nAverage: ${formatHoursDetailed(avg30d)}\nWindow: last 30 days`;
  const deltaTooltip30d =
    medianChange30d !== null || avgChange30d !== null
      ? `${
          priorMedian30d !== null && medianChange30d !== null
            ? `Previous 30-day median: ${formatHoursDetailed(priorMedian30d)}\nChange: ${medianChange30d >= 0 ? "+" : ""}${Math.round(medianChange30d)}%`
            : ""
        }${
          priorAvg30d !== null && avgChange30d !== null
            ? `${priorMedian30d !== null && medianChange30d !== null ? "\n\n" : ""}Previous 30-day average: ${formatHoursDetailed(priorAvg30d)}\nChange: ${avgChange30d >= 0 ? "+" : ""}${Math.round(avgChange30d)}%`
            : ""
        }`
      : undefined;

  const stats = [
    {
      label: "Last 7 Days",
      value: <CombinedStatValue medianValue={median7d} avgValue={avg7d} tooltip={valueTooltip7d} />,
      changePercent: medianChange7d,
      changePercentSecondary: avgChange7d,
      deltaTooltip: deltaTooltip7d,
    },
    {
      label: "Last 30 Days",
      value: (
        <CombinedStatValue medianValue={median30d} avgValue={avg30d} tooltip={valueTooltip30d} />
      ),
      changePercent: medianChange30d,
      changePercentSecondary: avgChange30d,
      deltaTooltip: deltaTooltip30d,
    },
  ];

  return (
    <MetricUnit
      title="Time to Merge"
      stats={stats}
      chart={<WeeklyCombinedMergeTimesChart weeklyTrends={weeklyTrends} />}
      invertColors
    />
  );
}
