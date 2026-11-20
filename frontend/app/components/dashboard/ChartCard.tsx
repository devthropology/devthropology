import * as React from "react";
import { SimpleTooltip } from "~/components/ui/SimpleTooltip";

export type ViewMode = "count" | "percentage";

interface MetricStat {
  label: string;
  value: string | number | React.ReactNode;
  changePercent?: number | null;
  period?: string;
  deltaTooltip?: string; // Tooltip for the change percent only
}

interface ChartCardProps {
  title: string;
  stats: MetricStat[];
  renderChart: (viewMode: ViewMode) => React.ReactNode;
  className?: string;
  invertColors?: boolean;
}

interface ViewModeToggleProps {
  viewMode: ViewMode;
  onChange: (mode: ViewMode) => void;
}

function ViewModeToggle({ viewMode, onChange }: ViewModeToggleProps) {
  const buttonBase = "px-3 py-1 text-sm font-semibold rounded-md transition-colors";

  return (
    <div className="inline-flex items-center gap-1 rounded-md bg-white/10 p-1">
      <button
        type="button"
        onClick={() => onChange("count")}
        aria-label="Show absolute counts"
        aria-pressed={viewMode === "count"}
        className={`${buttonBase} ${
          viewMode === "count" ? "bg-white text-slate-900" : "text-white hover:bg-white/10"
        }`}
      >
        #
      </button>
      <button
        type="button"
        onClick={() => onChange("percentage")}
        aria-label="Show normalized percentages"
        aria-pressed={viewMode === "percentage"}
        className={`${buttonBase} ${
          viewMode === "percentage" ? "bg-white text-slate-900" : "text-white hover:bg-white/10"
        }`}
      >
        %
      </button>
    </div>
  );
}

export function ChartCard({
  title,
  stats,
  renderChart,
  className = "",
  invertColors = false,
}: ChartCardProps) {
  const [viewMode, setViewMode] = React.useState<ViewMode>("count");

  return (
    <div className={`bg-white/5 p-6 rounded-lg ${className}`}>
      <div className="mb-6 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-2xl font-bold text-white">{title}</h2>
          <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
        </div>

        <div className="flex gap-4 overflow-x-auto">
          {stats.map((stat, index) => (
            <div key={index} className="flex-1 min-w-[140px] rounded bg-white/5 p-3">
              <div className="flex items-baseline justify-between gap-2">
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
              <div className="mt-1 text-xl font-bold text-white">
                {typeof stat.value === "number" ? stat.value.toLocaleString() : stat.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded bg-white/5 p-4">{renderChart(viewMode)}</div>
    </div>
  );
}
