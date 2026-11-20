export function formatMetricValue(value: number): string {
  const absValue = Math.abs(value);
  const thresholds = [
    { threshold: 1_000_000_000, suffix: "B" },
    { threshold: 1_000_000, suffix: "M" },
    { threshold: 1_000, suffix: "k" },
  ];

  for (const { threshold, suffix } of thresholds) {
    if (absValue >= threshold) {
      const rounded = Math.round((value / threshold) * 10) / 10;
      const formatted = Number(rounded.toFixed(1)).toString();
      return `${formatted}${suffix}`;
    }
  }

  return value.toLocaleString();
}
