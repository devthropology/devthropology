import { UserSchema } from "./user.ts";
import { DateSchema } from "./dateSchema.ts";
import { z } from "zod";
import { State } from "./state.ts";
import { HydratedPullRequestSchema } from "./hydratedPullRequest.ts";
import { IssueType } from "./issueType.ts";

const PullRequestLinkSchema = z.object({
  url: z.string(),
});
export const BasicIssueSchema = z.object({
  user: UserSchema,

  title: z.string(),
  number: z.number(),
  state: z.nativeEnum(State),
  body: z.string().nullable(),

  created_at: DateSchema,
  updated_at: DateSchema,
  closed_at: DateSchema.nullable(),

  pull_request: PullRequestLinkSchema.optional(),
});

export const HydratedIssueSchema = BasicIssueSchema.extend({
  hydrated_pull_request: HydratedPullRequestSchema.optional(),
  type: z.nativeEnum(IssueType),
});

// Define type aliases for convenience
export type BasicIssue = z.infer<typeof BasicIssueSchema>;
export type HydratedIssue = z.infer<typeof HydratedIssueSchema>;
