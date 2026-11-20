import { z } from "zod";

export const PullRequestEnhancedStatsSchema = z.object({
  roundsOfReview: z.number().int().nonnegative(),
  botRoundsOfReview: z.number().int().nonnegative(),
  firstReviewAt: z.date().nullable(),
  firstApprovalAt: z.date().nullable(),
  firstEffectiveApprovalAt: z.date().nullable(),
  mergedAfterPostApprovalCommit: z.boolean(),
  aiAssistedModel: z.string().nullable(),
});

export type PullRequestEnhancedStats = z.infer<
  typeof PullRequestEnhancedStatsSchema
>;
