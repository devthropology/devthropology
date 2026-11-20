import { UserSchema } from "./user.ts";
import { DateSchema } from "./dateSchema.ts";
import { z } from "zod";
import { State } from "./state.ts";

export type PullRequest = z.infer<typeof PullRequestSchema>;
export const PullRequestSchema = z.object({
  user: UserSchema,

  title: z.string(),
  number: z.number(),
  state: z.nativeEnum(State),
  body: z.string().nullable(),

  created_at: DateSchema,
  updated_at: DateSchema,
  closed_at: DateSchema.nullable(),
  merged_at: DateSchema.nullable(),
  merge_commit_sha: z.string().nullable(),

  head: z.object({
    ref: z.string(),
  }),
  base: z.object({
    ref: z.string(),
  }),

  comments: z.number(),
  review_comments: z.number(),
  commits: z.number(),
  additions: z.number(),
  deletions: z.number(),
  changed_files: z.number(),
});
