import { z } from "zod";

export const MetricCategoryEnum = z.enum([
  "elite",
  "high",
  "average",
  "low",
  "at-risk",
  "unknown",
]);
export type MetricCategory = z.infer<typeof MetricCategoryEnum>;

export const MetricDirectionEnum = z.enum(["higher", "lower"]);
export type MetricDirection = z.infer<typeof MetricDirectionEnum>;

export const MetricRatingSchema = z.object({
  value: z.number().nullable(),
  category: MetricCategoryEnum,
});

export type MetricRating<T extends number | null = number | null> = {
  value: T;
  category: MetricCategory;
};

export const MetricPercentilesSchema = z.object({
  p10: z.number(),
  p25: z.number(),
  p50: z.number(),
  p75: z.number(),
  p90: z.number(),
});
export type MetricPercentiles = z.infer<typeof MetricPercentilesSchema>;
