import { GHOST_USER, UserSchema } from "./user.ts";
import { DateSchema } from "./dateSchema.ts";
import { z } from "zod";

import { AuthorAssociation } from "./authorAssociation.ts";

// GitHub can return NUL characters, which PostgreSQL text columns reject.
const CommentBodySchema = z
  .string()
  .transform((body) => body.replaceAll("\u0000", ""));

export const CommentReactionsSchema = z.object({
  "+1": z.number().int().nonnegative(),
  "-1": z.number().int().nonnegative(),
  laugh: z.number().int().nonnegative(),
  hooray: z.number().int().nonnegative(),
  confused: z.number().int().nonnegative(),
  heart: z.number().int().nonnegative(),
  rocket: z.number().int().nonnegative(),
  eyes: z.number().int().nonnegative(),
});

export type Comment = z.infer<typeof GhCommentSchema>;
export const GhCommentSchema = z
  .object({
    id: z.number(),
    path: z.string(),
    pull_request_review_id: z.number().nullish(),
    in_reply_to_id: z.number().nullish(),
    line: z.number().int().nullish(),
    start_line: z.number().int().nullish(),
    original_line: z.number().int().nullish(),
    original_start_line: z.number().int().nullish(),
    side: z.string().nullish(),
    start_side: z.string().nullish(),
    subject_type: z.string().nullish(),
    commit_id: z.string().nullish(),
    original_commit_id: z.string().nullish(),
    diff_hunk: CommentBodySchema.nullish(),
    reactions: CommentReactionsSchema.nullish(),
    reactions_observed_at: DateSchema.nullish(),
    body: CommentBodySchema,
    // If a github account is deleted, this is null
    user: UserSchema.nullable(),
    created_at: DateSchema,
    updated_at: DateSchema,
    author_association: z.nativeEnum(AuthorAssociation),
    // link, reactions?
  })
  .transform((comment) => {
    if (comment.user == null) {
      comment.user = GHOST_USER;
    }
    return comment;
  });

export type IssueComment = z.infer<typeof GhIssueCommentSchema>;
export const GhIssueCommentSchema = z
  .object({
    id: z.number(),
    body: CommentBodySchema,
    // If a github account is deleted, this is null
    user: UserSchema.nullable(),
    created_at: DateSchema,
    updated_at: DateSchema,
    author_association: z.nativeEnum(AuthorAssociation),
    // link, reactions?
  })
  .transform((comment) => {
    if (comment.user == null) {
      comment.user = GHOST_USER;
    }
    return comment;
  });
