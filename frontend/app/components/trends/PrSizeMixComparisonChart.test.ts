import { describe, expect, it } from "vitest";
import { getPrSizeMixTrendColor } from "./PrSizeMixComparisonChart";

describe("getPrSizeMixTrendColor", () => {
  it("treats micro deltas as neutral", () => {
    expect(getPrSizeMixTrendColor("Micro (0-10)", 5)).toBe("#9ca3af");
    expect(getPrSizeMixTrendColor("Micro (0-10)", -5)).toBe("#9ca3af");
  });

  it("rewards growth in small and medium buckets", () => {
    expect(getPrSizeMixTrendColor("Small (11-75)", 2)).toBe("#4ade80");
    expect(getPrSizeMixTrendColor("Small (11-75)", -2)).toBe("#f87171");
    expect(getPrSizeMixTrendColor("Medium (76-250)", 2)).toBe("#4ade80");
    expect(getPrSizeMixTrendColor("Medium (76-250)", -2)).toBe("#f87171");
  });

  it("rewards shrinkage in large and larger buckets", () => {
    expect(getPrSizeMixTrendColor("Large (251-500)", 2)).toBe("#f87171");
    expect(getPrSizeMixTrendColor("Large (251-500)", -2)).toBe("#4ade80");
    expect(getPrSizeMixTrendColor("XL (501-1000)", 2)).toBe("#f87171");
    expect(getPrSizeMixTrendColor("XL (501-1000)", -2)).toBe("#4ade80");
    expect(getPrSizeMixTrendColor("Oversized (1000+)", 2)).toBe("#f87171");
    expect(getPrSizeMixTrendColor("Oversized (1000+)", -2)).toBe("#4ade80");
  });

  it("keeps near-zero deltas muted", () => {
    expect(getPrSizeMixTrendColor("Small (11-75)", 0.01)).toBe("rgba(226, 232, 240, 0.92)");
    expect(getPrSizeMixTrendColor("Oversized (1000+)", -0.01)).toBe("rgba(226, 232, 240, 0.92)");
  });
});
