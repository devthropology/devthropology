import { z } from "zod";

export const RepositoryContributorMonthlyContributorSchema = z.object({
  userId: z.coerce.number().int(),
  login: z.string(),
  date: z.string(),
});

export type RepositoryContributorMonthlyContributor = z.infer<
  typeof RepositoryContributorMonthlyContributorSchema
>;

export const RepositoryContributorMonthlyBucketSchema = z.object({
  count: z.coerce.number().int(),
  contributors: z.array(RepositoryContributorMonthlyContributorSchema),
});

export type RepositoryContributorMonthlyBucket = z.infer<
  typeof RepositoryContributorMonthlyBucketSchema
>;

export const RepositoryContributorsMonthlyEntrySchema = z.object({
  year: z.coerce.number().int(),
  month: z.coerce.number().int().min(1).max(12),
  active: RepositoryContributorMonthlyBucketSchema,
  new: RepositoryContributorMonthlyBucketSchema,
  churned: RepositoryContributorMonthlyBucketSchema,
});

export type RepositoryContributorsMonthlyEntry = z.infer<
  typeof RepositoryContributorsMonthlyEntrySchema
>;

export const RepositoryContributorsMonthlyResponseSchema = z.object({
  months: z.array(RepositoryContributorsMonthlyEntrySchema),
});

export type RepositoryContributorsMonthlyResponse = z.infer<
  typeof RepositoryContributorsMonthlyResponseSchema
>;
