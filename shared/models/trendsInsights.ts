import { z } from "zod";

export const AI_PR_SIZE_BUCKETS = [
  "Micro (0-10)",
  "Small (11-75)",
  "Medium (76-250)",
  "Large (251-500)",
  "XL (501-1000)",
  "Oversized (1000+)",
] as const;

export const TrendsPrSizeBucketSchema = z.enum(AI_PR_SIZE_BUCKETS);
export type TrendsPrSizeBucket = z.infer<typeof TrendsPrSizeBucketSchema>;

export const TrendsReviewRoundsMonthlyPointSchema = z.object({
  year: z.coerce.number().int(),
  month: z.coerce.number().int().min(1).max(12),
  avgRounds: z.coerce.number().nullable(),
  avgAllRounds: z.coerce.number().nullable(),
  p50Rounds: z.coerce.number().nullable(),
  p75Rounds: z.coerce.number().nullable(),
  p90Rounds: z.coerce.number().nullable(),
  p95Rounds: z.coerce.number().nullable(),
  p99Rounds: z.coerce.number().nullable(),
  pctZeroRounds: z.coerce.number().nullable(),
  pctOneRound: z.coerce.number().nullable(),
  pctTwoRounds: z.coerce.number().nullable(),
  pctThreePlusRounds: z.coerce.number().nullable(),
  pctAnyRound: z.coerce.number().nullable(),
  pctTwoPlusRounds: z.coerce.number().nullable(),
  pctAnyAllRounds: z.coerce.number().nullable(),
  pctTwoPlusAllRounds: z.coerce.number().nullable(),
  p50TimeToFirstReviewHours: z.coerce.number().nullable(),
  p75TimeToFirstReviewHours: z.coerce.number().nullable(),
  p90TimeToFirstReviewHours: z.coerce.number().nullable(),
  p50TimeToEffectiveApprovalHours: z.coerce.number().nullable(),
  p75TimeToEffectiveApprovalHours: z.coerce.number().nullable(),
  p90TimeToEffectiveApprovalHours: z.coerce.number().nullable(),
});

export type TrendsReviewRoundsMonthlyPoint = z.infer<
  typeof TrendsReviewRoundsMonthlyPointSchema
>;

export const TrendsReviewRoundsInsightsResponseSchema = z.object({
  points: z.array(TrendsReviewRoundsMonthlyPointSchema),
});

export type TrendsReviewRoundsInsightsResponse = z.infer<
  typeof TrendsReviewRoundsInsightsResponseSchema
>;

export const TrendsPrSizeMonthlyPointSchema = z.object({
  year: z.coerce.number().int(),
  month: z.coerce.number().int().min(1).max(12),
  sizeBucket: TrendsPrSizeBucketSchema,
  prs: z.coerce.number().int(),
  pctOfMonthPrs: z.coerce.number(),
  avgRounds: z.coerce.number().nullable(),
  avgAllRounds: z.coerce.number().nullable(),
  pctZeroRounds: z.coerce.number().nullable(),
  pctAnyRound: z.coerce.number().nullable(),
  p50TimeToFirstReviewHours: z.coerce.number().nullable(),
  p75TimeToFirstReviewHours: z.coerce.number().nullable(),
  p90TimeToFirstReviewHours: z.coerce.number().nullable(),
  p50TimeToEffectiveApprovalHours: z.coerce.number().nullable(),
  p75TimeToEffectiveApprovalHours: z.coerce.number().nullable(),
  p90TimeToEffectiveApprovalHours: z.coerce.number().nullable(),
});

export type TrendsPrSizeMonthlyPoint = z.infer<
  typeof TrendsPrSizeMonthlyPointSchema
>;

export const TrendsPrSizeInsightsResponseSchema = z.object({
  points: z.array(TrendsPrSizeMonthlyPointSchema),
});

export type TrendsPrSizeInsightsResponse = z.infer<
  typeof TrendsPrSizeInsightsResponseSchema
>;

export const TrendsPrSizePercentileMonthlyPointSchema = z.object({
  year: z.coerce.number().int(),
  month: z.coerce.number().int().min(1).max(12),
  mergedPrs: z.coerce.number().int(),
  avgPrSize: z.coerce.number().nullable(),
  p50PrSize: z.coerce.number().nullable(),
  p75PrSize: z.coerce.number().nullable(),
  p90PrSize: z.coerce.number().nullable(),
});

export type TrendsPrSizePercentileMonthlyPoint = z.infer<
  typeof TrendsPrSizePercentileMonthlyPointSchema
>;

export const TrendsAuthorOutputMonthlyPointSchema = z.object({
  year: z.coerce.number().int(),
  month: z.coerce.number().int().min(1).max(12),
  activeAuthors: z.coerce.number().int(),
  avgMergedPrsPerAuthor: z.coerce.number().nullable(),
  p50MergedPrsPerAuthor: z.coerce.number().nullable(),
  p75MergedPrsPerAuthor: z.coerce.number().nullable(),
  p90MergedPrsPerAuthor: z.coerce.number().nullable(),
  avgLinesChangedPerAuthor: z.coerce.number().nullable(),
  p50LinesChangedPerAuthor: z.coerce.number().nullable(),
  p75LinesChangedPerAuthor: z.coerce.number().nullable(),
  p90LinesChangedPerAuthor: z.coerce.number().nullable(),
});

export type TrendsAuthorOutputMonthlyPoint = z.infer<
  typeof TrendsAuthorOutputMonthlyPointSchema
>;

export const TrendsAuthorOutputResponseSchema = z.object({
  points: z.array(TrendsAuthorOutputMonthlyPointSchema),
});

export type TrendsAuthorOutputResponse = z.infer<
  typeof TrendsAuthorOutputResponseSchema
>;

export const TrendsAiAssistedMonthlyPointSchema = z.object({
  year: z.coerce.number().int(),
  month: z.coerce.number().int().min(1).max(12),
  mergedPrs: z.coerce.number().int(),
  aiAssistedPrs: z.coerce.number().int(),
  pctAiAssistedPrs: z.coerce.number(),
});

export type TrendsAiAssistedMonthlyPoint = z.infer<
  typeof TrendsAiAssistedMonthlyPointSchema
>;

export const TrendsAiAssistedModelMonthlyPointSchema = z.object({
  year: z.coerce.number().int(),
  month: z.coerce.number().int().min(1).max(12),
  model: z.string(),
  mergedPrs: z.coerce.number().int(),
  aiAssistedPrs: z.coerce.number().int(),
  pctAiAssistedPrs: z.coerce.number(),
});

export type TrendsAiAssistedModelMonthlyPoint = z.infer<
  typeof TrendsAiAssistedModelMonthlyPointSchema
>;

export const TrendsAiAssistedInsightsResponseSchema = z.object({
  points: z.array(TrendsAiAssistedMonthlyPointSchema),
  modelPoints: z.array(TrendsAiAssistedModelMonthlyPointSchema),
});

export type TrendsAiAssistedInsightsResponse = z.infer<
  typeof TrendsAiAssistedInsightsResponseSchema
>;

export const TrendsPrSizePercentilesResponseSchema = z.object({
  points: z.array(TrendsPrSizePercentileMonthlyPointSchema),
  authorOutput: TrendsAuthorOutputResponseSchema,
});

export type TrendsPrSizePercentilesResponse = z.infer<
  typeof TrendsPrSizePercentilesResponseSchema
>;

export const TrendsReviewRoundsMonthlyMetricsSchema =
  TrendsReviewRoundsMonthlyPointSchema.omit({
    year: true,
    month: true,
  });

export type TrendsReviewRoundsMonthlyMetrics = z.infer<
  typeof TrendsReviewRoundsMonthlyMetricsSchema
>;

export const TrendsPrSizeDistributionBucketSchema =
  TrendsPrSizeMonthlyPointSchema.omit({
    year: true,
    month: true,
  });

export type TrendsPrSizeDistributionBucket = z.infer<
  typeof TrendsPrSizeDistributionBucketSchema
>;

export const TrendsPrSizeMonthlyMetricsSchema =
  TrendsPrSizePercentileMonthlyPointSchema.omit({
    year: true,
    month: true,
    mergedPrs: true,
  });

export type TrendsPrSizeMonthlyMetrics = z.infer<
  typeof TrendsPrSizeMonthlyMetricsSchema
>;

export const TrendsAuthorOutputMonthlyMetricsSchema =
  TrendsAuthorOutputMonthlyPointSchema.omit({
    year: true,
    month: true,
  });

export type TrendsAuthorOutputMonthlyMetrics = z.infer<
  typeof TrendsAuthorOutputMonthlyMetricsSchema
>;

export const TrendsAiAssistedModelMonthlyMetricsSchema =
  TrendsAiAssistedModelMonthlyPointSchema.omit({
    year: true,
    month: true,
    mergedPrs: true,
  });

export type TrendsAiAssistedModelMonthlyMetrics = z.infer<
  typeof TrendsAiAssistedModelMonthlyMetricsSchema
>;

export const TrendsAiAssistedMonthlyMetricsSchema = z.object({
  aiAssistedPrs: z.coerce.number().int(),
  pctAiAssistedPrs: z.coerce.number(),
  models: z.array(TrendsAiAssistedModelMonthlyMetricsSchema),
});

export type TrendsAiAssistedMonthlyMetrics = z.infer<
  typeof TrendsAiAssistedMonthlyMetricsSchema
>;

export const TrendsInsightsMonthlySchema = z.object({
  year: z.coerce.number().int(),
  month: z.coerce.number().int().min(1).max(12),
  mergedPrs: z.coerce.number().int().nullable(),
  reviewRounds: TrendsReviewRoundsMonthlyMetricsSchema.nullable(),
  prSize: TrendsPrSizeMonthlyMetricsSchema.nullable(),
  authorOutput: TrendsAuthorOutputMonthlyMetricsSchema.nullable(),
  prSizeDistribution: z.object({
    buckets: z.array(TrendsPrSizeDistributionBucketSchema),
  }),
  aiAssisted: TrendsAiAssistedMonthlyMetricsSchema.nullable(),
});

export type TrendsInsightsMonthly = z.infer<typeof TrendsInsightsMonthlySchema>;

export const TrendsInsightsResponseSchema = z.object({
  monthly: z.array(TrendsInsightsMonthlySchema),
});

export type TrendsInsightsResponse = z.infer<
  typeof TrendsInsightsResponseSchema
>;
