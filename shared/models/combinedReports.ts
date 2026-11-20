import { z } from "zod";

export const MAX_REPORT_REPOSITORIES = 20;

export const CombinedReportSelectionSchema = z
  .object({
    workspaceId: z.string().min(1),
    // Public repository refs; the backend resolves and authorizes these IDs.
    repositoryIds: z
      .array(z.string().min(1).max(64))
      .min(1)
      .max(MAX_REPORT_REPOSITORIES),
    report: z.enum(["authors", "reviewers"]),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
  })
  .refine((selection) => selection.startDate <= selection.endDate, {
    message: "Start date must be on or before end date.",
  });

export type CombinedReportSelection = z.infer<
  typeof CombinedReportSelectionSchema
>;
