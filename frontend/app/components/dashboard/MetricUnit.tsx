import * as React from "react";
import { SimpleTooltip } from "~/components/ui/SimpleTooltip";

interface MetricStat {
  label: string;
  value: string | number | React.ReactNode;
  changePercent?: number | null; // Primary change to display (median for Time to Merge)
  changePercentSecondary?: number | null; // Secondary change (average for Time to Merge)
  period?: string; // e.g., "vs prior week"
  valueTooltip?: string; // Tooltip for the value
  deltaTooltip?: string; // Tooltip for the change percent (can include both metrics)
}

interface Props {
  title: string;
  stats: MetricStat[];
  chart: React.ReactNode;
  className?: string;
  invertColors?: boolean; // For time metrics where decrease is good (green), increase is bad (red)
}

export function MetricUnit({ title, stats, chart, className = "", invertColors = false }: Props) {
  return (
    <div className={`bg-white/5 p-6 rounded-lg ${className}`}>
      <h2 className="text-2xl font-bold mb-4 text-white">{title}</h2>

      {/* Compact Stats Row */}
      <div className="flex gap-3 mb-4">
        {stats.map((stat, index) => (
          <div key={index} className="flex-1 min-w-[140px] bg-white/5 p-3 rounded">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-medium text-gray-400">{stat.label}</span>
              {stat.changePercent !== null && stat.changePercent !== undefined && (
                <SimpleTooltip content={stat.deltaTooltip || ""}>
                  <span
                    className={`text-xs ${
                      invertColors
                        ? stat.changePercent >= 0
                          ? "text-red-400"
                          : "text-green-400"
                        : stat.changePercent >= 0
                          ? "text-green-400"
                          : "text-red-400"
                    }`}
                  >
                    {stat.changePercent >= 0 ? "+" : "−"}
                    {Math.abs(stat.changePercent).toLocaleString()}%
                  </span>
                </SimpleTooltip>
              )}
            </div>
            <div className="text-xl font-bold text-white">
              {typeof stat.value === "number" ? (
                stat.valueTooltip ? (
                  <SimpleTooltip content={stat.valueTooltip}>
                    <span>
                      {stat.value.toLocaleString()}
                      {stat.label.toLowerCase().includes("pr") ? " PRs" : ""}
                    </span>
                  </SimpleTooltip>
                ) : (
                  `${stat.value.toLocaleString()}${
                    stat.label.toLowerCase().includes("pr") ? " PRs" : ""
                  }`
                )
              ) : (
                stat.value
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="bg-white/5 p-4 rounded">{chart}</div>
    </div>
  );
}
