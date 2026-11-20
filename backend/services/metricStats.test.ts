import { test } from "vitest";
import {
  deepStrictEqual as assertEquals,
  ok as assert,
} from "node:assert/strict";
import {
  categorizeValue,
  computeMetricDistribution,
  selectCategoryRepresentativeValue,
} from "./metricStats.ts";

test("computeMetricDistribution returns expected percentiles", () => {
  const distribution = computeMetricDistribution([1, 2, 3, 4, 5]);

  if (!distribution) {
    throw new Error("Expected distribution to be defined");
  }

  assertEquals(distribution.min, 1);
  assertEquals(distribution.max, 5);
  assert(Math.abs(distribution.p10 - 1.4) <= 1e-7);
  assert(Math.abs(distribution.p25 - 2) <= 1e-7);
  assert(Math.abs(distribution.p50 - 3) <= 1e-7);
  assert(Math.abs(distribution.p75 - 4) <= 1e-7);
  assert(Math.abs(distribution.p90 - 4.6) <= 1e-7);
});

test("categorizeValue respects direction and bounds", () => {
  const distribution = computeMetricDistribution([1, 2, 3, 4, 5]);

  if (!distribution) {
    throw new Error("Expected distribution to be defined");
  }

  assertEquals(categorizeValue(5, distribution, "higher"), "elite");
  assertEquals(categorizeValue(4, distribution, "higher"), "high");
  assertEquals(categorizeValue(2, distribution, "higher"), "average");
  assertEquals(categorizeValue(1.4, distribution, "higher"), "low");
  assertEquals(categorizeValue(1.2, distribution, "higher"), "at-risk");

  assertEquals(categorizeValue(1, distribution, "lower"), "elite");
  assertEquals(categorizeValue(2, distribution, "lower"), "high");
  assertEquals(categorizeValue(4, distribution, "lower"), "average");
  assertEquals(categorizeValue(4.6, distribution, "lower"), "low");
});

test("selectCategoryRepresentativeValue uses correct bound by direction", () => {
  const distribution = computeMetricDistribution([1, 2, 3, 4, 5]);

  if (!distribution) {
    throw new Error("Expected distribution to be defined");
  }

  assert(
    Math.abs(
      selectCategoryRepresentativeValue(distribution, "higher", "elite") -
        distribution.p90,
    ) <= 1e-7,
  );
  assert(
    Math.abs(
      selectCategoryRepresentativeValue(distribution, "lower", "elite") -
        distribution.p10,
    ) <= 1e-7,
  );
});
