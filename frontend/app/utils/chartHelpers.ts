import { useMemo } from "react";
import type { ViewMode } from "../components/dashboard/ChartCard";

export function useChartNormalization(rawDatasets: number[][], viewMode: ViewMode) {
  return useMemo(() => {
    if (!rawDatasets.length) {
      return { totals: [] as number[], normalizedDatasets: [] as number[][] };
    }

    const totals = rawDatasets[0].map((_, columnIndex) =>
      rawDatasets.reduce((sum, dataset) => sum + (dataset[columnIndex] ?? 0), 0),
    );

    const normalizedDatasets = rawDatasets.map((dataset) => {
      if (viewMode === "count") return dataset;

      return dataset.map((value, index) => {
        const total = totals[index] ?? 0;
        return total === 0 ? 0 : (value / total) * 100;
      });
    });

    return { totals, normalizedDatasets };
  }, [rawDatasets, viewMode]);
}
