import { z } from "zod";

// Response model for individual review entries
export const ReviewEntrySchema = z.object({
  issueId: z.number(),
  title: z.string(),
  authorLogin: z.string(),
  createdAt: z.string(), // ISO date string
  status: z.enum(["Merged", "Closed", "Open"]),
  additions: z.number().nullable().optional(),
  deletions: z.number().nullable().optional(),
  changedFiles: z.number().nullable().optional(),
  roundsOfReview: z.number().nullable().optional(),
  reviewStatus: z.preprocess(
    (val) =>
      String(val)
        .split(/[_\s]+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" "),
    z.enum(["Approved", "Requested Changes", "Dismissed", "Commented"]),
  ),
  wasFirstReviewer: z.boolean().nullable(),
  timeToFirstReview: z.number().nullable(), // Time in hours as number
  authorComments: z.number(),
  reviewerComments: z.number(),
  otherUserComments: z.number(),
  botComments: z.number(),
});
export type ReviewEntry = z.infer<typeof ReviewEntrySchema>;

// Response model for user review statistics
export const UserReviewStatsSchema = z.object({
  recentReviews: z.array(ReviewEntrySchema),
  repoOwner: z.string(),
  repoName: z.string(),
  // Future: could add aggregate stats here like total reviews, avg time, etc.
});
export type UserReviewStats = z.infer<typeof UserReviewStatsSchema>;
