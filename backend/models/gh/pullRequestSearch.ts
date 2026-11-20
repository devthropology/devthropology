import { z } from "zod";
import { DateSchema } from "./dateSchema.ts";

export type PullRequestSearch = z.infer<typeof PullRequestSearchSchema>;
export const PullRequestSearchSchema = z.object({
  total_count: z.number(),
  incomplete_results: z.boolean(),
  items: z.array(
    z.object({
      number: z.number(),
      created_at: DateSchema,
    }),
  ),
});
