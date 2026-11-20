import { z } from "zod";

// Response model for individual pull request entries
export const PullEntrySchema = z.object({
  issueId: z.number(),
  title: z.string(),
  status: z.enum(["open", "closed", "merged"]),
  createdAt: z.string(), // ISO date string
  closedAt: z.string().nullable(),
  additions: z.number().nullable().optional(),
  deletions: z.number().nullable().optional(),
  changedFiles: z.number().nullable().optional(),
  roundsOfReview: z.number().nullable().optional(),
  botRoundsOfReview: z.number().nullable().optional(),
  authorComments: z.number().nullable().optional(),
  nonAuthorComments: z.number().nullable().optional(),
  botComments: z.number().nullable().optional(),
  firstReviewTime: z.string().nullable().optional(), // ISO date string
  firstApprovalTime: z.string().nullable().optional(), // ISO date string
});
export type PullEntry = z.infer<typeof PullEntrySchema>;

// Response model for user pull request statistics
export const UserPullStatsSchema = z.object({
  recentPulls: z.array(PullEntrySchema),
  repoOwner: z.string(),
  repoName: z.string(),
});
export type UserPullStats = z.infer<typeof UserPullStatsSchema>;
