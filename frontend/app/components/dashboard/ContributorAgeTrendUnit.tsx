import * as React from "react";
import { MetricUnit } from "./MetricUnit";
import { WeeklyContributorAgeChart } from "./WeeklyContributorAgeChart";
import { SimpleTooltip } from "~/components/ui/SimpleTooltip";

interface WeeklyVolume {
  weekStartDate: string;
  avgContributorAgeDays: number | null;
  medianContributorAgeDays: number | null;
}

interface VolumeSnapshot {
  avgContributorAgeDays: number | null;
  avgContributorAgeDaysChangePercent: number | null;
  medianContributorAgeDays: number | null;
  medianContributorAgeDaysChangePercent: number | null;
}

interface Props {
  current7d: VolumeSnapshot;
  current30d: VolumeSnapshot;
  weeklyTrends: WeeklyVolume[];
}

// Format for display (compact)
function formatAgeDaysCompact(days: number | null): string {
  if (days === null) return "N/A";
  if (days < 30) {
    return `${Math.round(days)}d`;
  }
  if (days < 365) {
    return `${(days / 30).toFixed(1)}mo`;
  }
  return `${(days / 365).toFixed(1)}y`;
}

// Format for tooltip (detailed)
function formatAgeDaysDetailed(days: number | null): string {
  if (days === null) return "N/A";
  if (days < 30) {
    return `${Math.round(days)} days`;
  }
  if (days < 365) {
    const months = days / 30;
    return `${months.toFixed(1)} months`;
  }
  const years = days / 365;
  return `${years.toFixed(1)} years`;
}

// Calculate prior value from current and change percent
function calculatePrior(current: number | null, changePercent: number | null): number | null {
  if (current === null || changePercent === null) return null;
  return current / (1 + changePercent / 100);
}

// Compact stat component showing median and average side by side
function CombinedAgeStatValue({
  medianValue,
  avgValue,
  tooltip,
}: {
  medianValue: number | null;
  avgValue: number | null;
  tooltip: string;
}) {
  const medianFormatted = formatAgeDaysCompact(medianValue);
  const avgFormatted = formatAgeDaysCompact(avgValue);

  return (
    <SimpleTooltip content={tooltip}>
      <span className="inline-flex items-baseline gap-2 whitespace-nowrap text-lg sm:gap-3 sm:text-xl">
        <span className="text-blue-400">{medianFormatted}</span>
        <span className="text-gray-500">/</span>
        <span className="text-purple-400">{avgFormatted}</span>
      </span>
    </SimpleTooltip>
  );
}

export function ContributorAgeTrendUnit({ current7d, current30d, weeklyTrends }: Props) {
  // Build tooltip content for 7-day stats
  const median7d = current7d.medianContributorAgeDays;
  const avg7d = current7d.avgContributorAgeDays;
  const medianChange7d = current7d.medianContributorAgeDaysChangePercent;
  const avgChange7d = current7d.avgContributorAgeDaysChangePercent;
  const priorMedian7d = calculatePrior(median7d, medianChange7d);
  const priorAvg7d = calculatePrior(avg7d, avgChange7d);

  const valueTooltip7d = `Median: ${formatAgeDaysDetailed(median7d)}\nAverage: ${formatAgeDaysDetailed(avg7d)}\nWindow: last 7 days`;
  const deltaTooltip7d =
    medianChange7d !== null || avgChange7d !== null
      ? `${
          priorMedian7d !== null && medianChange7d !== null
            ? `Previous 7-day median: ${formatAgeDaysDetailed(priorMedian7d)}\nChange: ${medianChange7d >= 0 ? "+" : ""}${Math.round(medianChange7d)}%`
            : ""
        }${
          priorAvg7d !== null && avgChange7d !== null
            ? `${priorMedian7d !== null && medianChange7d !== null ? "\n\n" : ""}Previous 7-day average: ${formatAgeDaysDetailed(priorAvg7d)}\nChange: ${avgChange7d >= 0 ? "+" : ""}${Math.round(avgChange7d)}%`
            : ""
        }`
      : undefined;

  // Build tooltip content for 30-day stats
  const median30d = current30d.medianContributorAgeDays;
  const avg30d = current30d.avgContributorAgeDays;
  const medianChange30d = current30d.medianContributorAgeDaysChangePercent;
  const avgChange30d = current30d.avgContributorAgeDaysChangePercent;
  const priorMedian30d = calculatePrior(median30d, medianChange30d);
  const priorAvg30d = calculatePrior(avg30d, avgChange30d);

  const valueTooltip30d = `Median: ${formatAgeDaysDetailed(median30d)}\nAverage: ${formatAgeDaysDetailed(avg30d)}\nWindow: last 30 days`;
  const deltaTooltip30d =
    medianChange30d !== null || avgChange30d !== null
      ? `${
          priorMedian30d !== null && medianChange30d !== null
            ? `Previous 30-day median: ${formatAgeDaysDetailed(priorMedian30d)}\nChange: ${medianChange30d >= 0 ? "+" : ""}${Math.round(medianChange30d)}%`
            : ""
        }${
          priorAvg30d !== null && avgChange30d !== null
            ? `${priorMedian30d !== null && medianChange30d !== null ? "\n\n" : ""}Previous 30-day average: ${formatAgeDaysDetailed(priorAvg30d)}\nChange: ${avgChange30d >= 0 ? "+" : ""}${Math.round(avgChange30d)}%`
            : ""
        }`
      : undefined;

  const stats = [
    {
      label: "Last 7 Days",
      value: (
        <CombinedAgeStatValue medianValue={median7d} avgValue={avg7d} tooltip={valueTooltip7d} />
      ),
      changePercent: medianChange7d,
      deltaTooltip: deltaTooltip7d,
    },
    {
      label: "Last 30 Days",
      value: (
        <CombinedAgeStatValue medianValue={median30d} avgValue={avg30d} tooltip={valueTooltip30d} />
      ),
      changePercent: medianChange30d,
      deltaTooltip: deltaTooltip30d,
    },
  ];

  return (
    <MetricUnit
      title="Author Tenure"
      stats={stats}
      chart={<WeeklyContributorAgeChart weeklyTrends={weeklyTrends} />}
    />
  );
}
