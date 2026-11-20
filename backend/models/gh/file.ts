import { z } from "zod";

export type File = z.infer<typeof FileSchema>;

export const FileSchema = z.object({
  filename: z.string(),
  status: z.string(),
  additions: z.number(),
  deletions: z.number(),
  changes: z.number(),
  previous_filename: z.string().optional(),
});
