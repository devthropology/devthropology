import { z } from "zod";
// Do I need this?
export type PullRequestNumber = z.infer<typeof PullRequestNumberSchema>;
export const PullRequestNumberSchema = z.object({
  number: z.number(),
});
