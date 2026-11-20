import { z } from "zod";

export const MonthlyMetricPointSchema = z.object({
  month: z.string(), // "2024-01"
  value: z.number(),
});

export const UserMonthlyMetricsSchema = z.object({
  months: z.array(z.string()),
  prsMerged: z.array(z.number()),
  linesModified: z.array(z.number()),
  prsReviewed: z.array(z.number()),
  prCommentsAdded: z.array(z.number()),
});

export type MonthlyMetricPoint = z.infer<typeof MonthlyMetricPointSchema>;
export type UserMonthlyMetrics = z.infer<typeof UserMonthlyMetricsSchema>;
