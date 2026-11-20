import { PullRequestSchema } from "./pullRequest.ts";
import { CommitSchema } from "./commit.ts";
import { z } from "zod";
import { ReviewSchema } from "./review.ts";
import { GhCommentSchema, GhIssueCommentSchema } from "./comment.ts";
import { FileSchema } from "./file.ts";

export type HydratedPullRequest = z.infer<typeof HydratedPullRequestSchema>;
export const HydratedPullRequestSchema = PullRequestSchema.extend({
  commentList: z.array(GhCommentSchema),
  commitList: z.array(CommitSchema),
  reviews: z.array(ReviewSchema),
  files: z.array(FileSchema),
  issueCommentList: z.array(GhIssueCommentSchema),
}).transform((pullRequest) => {
  // remove base.ref and head.ref
  const { base, head, ...rest } = pullRequest;
  return {
    sourceBranch: base.ref,
    targetBranch: head.ref,
    ...rest,
  };
});
