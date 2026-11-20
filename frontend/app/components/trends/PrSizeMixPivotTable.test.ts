import { describe, expect, it } from "vitest";
import type { TrendsPrSizeMonthlyPoint } from "../../../../shared/models/trendsInsights";
import { buildPrSizeMixPivotRows, getPrSizeMixPivotCell } from "./PrSizeMixPivotTable";

function point(
  input: Omit<
    TrendsPrSizeMonthlyPoint,
    | "avgAllRounds"
    | "p50TimeToFirstReviewHours"
    | "p75TimeToFirstReviewHours"
    | "p90TimeToFirstReviewHours"
    | "p50TimeToEffectiveApprovalHours"
    | "p75TimeToEffectiveApprovalHours"
    | "p90TimeToEffectiveApprovalHours"
  >,
): TrendsPrSizeMonthlyPoint {
  return {
    ...input,
    avgAllRounds: null,
    p50TimeToFirstReviewHours: null,
    p75TimeToFirstReviewHours: null,
    p90TimeToFirstReviewHours: null,
    p50TimeToEffectiveApprovalHours: null,
    p75TimeToEffectiveApprovalHours: null,
    p90TimeToEffectiveApprovalHours: null,
  };
}

const points: TrendsPrSizeMonthlyPoint[] = [
  point({
    year: 2026,
    month: 3,
    sizeBucket: "Micro (0-10)",
    prs: 10,
    pctOfMonthPrs: 10,
    avgRounds: 0,
    pctZeroRounds: 100,
    pctAnyRound: 0,
  }),
  point({
    year: 2026,
    month: 3,
    sizeBucket: "Small (11-75)",
    prs: 50,
    pctOfMonthPrs: 50,
    avgRounds: 0,
    pctZeroRounds: 100,
    pctAnyRound: 0,
  }),
  point({
    year: 2026,
    month: 3,
    sizeBucket: "Medium (76-250)",
    prs: 20,
    pctOfMonthPrs: 20,
    avgRounds: 0,
    pctZeroRounds: 100,
    pctAnyRound: 0,
  }),
  point({
    year: 2026,
    month: 3,
    sizeBucket: "Large (251-500)",
    prs: 10,
    pctOfMonthPrs: 10,
    avgRounds: 0,
    pctZeroRounds: 100,
    pctAnyRound: 0,
  }),
  point({
    year: 2026,
    month: 3,
    sizeBucket: "XL (501-1000)",
    prs: 5,
    pctOfMonthPrs: 5,
    avgRounds: 0,
    pctZeroRounds: 100,
    pctAnyRound: 0,
  }),
  point({
    year: 2026,
    month: 3,
    sizeBucket: "Oversized (1000+)",
    prs: 5,
    pctOfMonthPrs: 5,
    avgRounds: 0,
    pctZeroRounds: 100,
    pctAnyRound: 0,
  }),

  point({
    year: 2026,
    month: 2,
    sizeBucket: "Micro (0-10)",
    prs: 5,
    pctOfMonthPrs: 5,
    avgRounds: 0,
    pctZeroRounds: 100,
    pctAnyRound: 0,
  }),
  point({
    year: 2026,
    month: 2,
    sizeBucket: "Small (11-75)",
    prs: 35,
    pctOfMonthPrs: 35,
    avgRounds: 0,
    pctZeroRounds: 100,
    pctAnyRound: 0,
  }),
  point({
    year: 2026,
    month: 2,
    sizeBucket: "Medium (76-250)",
    prs: 30,
    pctOfMonthPrs: 30,
    avgRounds: 0,
    pctZeroRounds: 100,
    pctAnyRound: 0,
  }),
  point({
    year: 2026,
    month: 2,
    sizeBucket: "Large (251-500)",
    prs: 20,
    pctOfMonthPrs: 20,
    avgRounds: 0,
    pctZeroRounds: 100,
    pctAnyRound: 0,
  }),
  point({
    year: 2026,
    month: 2,
    sizeBucket: "XL (501-1000)",
    prs: 5,
    pctOfMonthPrs: 5,
    avgRounds: 0,
    pctZeroRounds: 100,
    pctAnyRound: 0,
  }),
  point({
    year: 2026,
    month: 2,
    sizeBucket: "Oversized (1000+)",
    prs: 5,
    pctOfMonthPrs: 5,
    avgRounds: 0,
    pctZeroRounds: 100,
    pctAnyRound: 0,
  }),

  point({
    year: 2025,
    month: 3,
    sizeBucket: "Micro (0-10)",
    prs: 10,
    pctOfMonthPrs: 10,
    avgRounds: 0,
    pctZeroRounds: 100,
    pctAnyRound: 0,
  }),
  point({
    year: 2025,
    month: 3,
    sizeBucket: "Small (11-75)",
    prs: 40,
    pctOfMonthPrs: 40,
    avgRounds: 0,
    pctZeroRounds: 100,
    pctAnyRound: 0,
  }),
  point({
    year: 2025,
    month: 3,
    sizeBucket: "Medium (76-250)",
    prs: 25,
    pctOfMonthPrs: 25,
    avgRounds: 0,
    pctZeroRounds: 100,
    pctAnyRound: 0,
  }),
  point({
    year: 2025,
    month: 3,
    sizeBucket: "Large (251-500)",
    prs: 15,
    pctOfMonthPrs: 15,
    avgRounds: 0,
    pctZeroRounds: 100,
    pctAnyRound: 0,
  }),
  point({
    year: 2025,
    month: 3,
    sizeBucket: "XL (501-1000)",
    prs: 5,
    pctOfMonthPrs: 5,
    avgRounds: 0,
    pctZeroRounds: 100,
    pctAnyRound: 0,
  }),
  point({
    year: 2025,
    month: 3,
    sizeBucket: "Oversized (1000+)",
    prs: 5,
    pctOfMonthPrs: 5,
    avgRounds: 0,
    pctZeroRounds: 100,
    pctAnyRound: 0,
  }),
];

describe("buildPrSizeMixPivotRows", () => {
  it("groups rows by month/year and sorts newest first", () => {
    const rows = buildPrSizeMixPivotRows(points, [2025, 2026]);

    expect(rows.map((row) => row.label)).toEqual(["Mar 2026", "Feb 2026", "Mar 2025"]);
    expect(rows[0]?.totalCount).toBe(100);
    expect(rows[0]?.counts["Small (11-75)"]).toBe(50);
  });
});

describe("getPrSizeMixPivotCell", () => {
  const [currentRow, priorMonthRow, sameMonthLastYearRow] = buildPrSizeMixPivotRows(
    points,
    [2025, 2026],
  );

  it("computes percent mix values with point deltas", () => {
    const cell = getPrSizeMixPivotCell(currentRow!, priorMonthRow!, "Small (11-75)", "mix");

    expect(cell.mainValue).toBe("50.0%");
    expect(cell.deltaText).toBe("(↑ 15.0 pp)");
    expect(cell.deltaColor).toBe("#4ade80");
  });

  it("computes count values with relative deltas", () => {
    const cell = getPrSizeMixPivotCell(currentRow!, priorMonthRow!, "Large (251-500)", "count");

    expect(cell.mainValue).toBe("10");
    expect(cell.deltaText).toBe("(↓ 50.0%)");
    expect(cell.deltaColor).toBe("#4ade80");
  });

  it("supports same-month-last-year comparisons", () => {
    const cell = getPrSizeMixPivotCell(
      currentRow!,
      sameMonthLastYearRow!,
      "Medium (76-250)",
      "mix",
    );

    expect(cell.mainValue).toBe("20.0%");
    expect(cell.deltaText).toBe("(↓ 5.0 pp)");
    expect(cell.deltaColor).toBe("#f87171");
  });

  it("omits deltas when no valid comparison is available", () => {
    const cell = getPrSizeMixPivotCell(sameMonthLastYearRow!, null, "Micro (0-10)", "count");

    expect(cell.mainValue).toBe("10");
    expect(cell.deltaText).toBeNull();
    expect(cell.deltaColor).toBeNull();
  });
});
