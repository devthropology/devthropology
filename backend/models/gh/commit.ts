import { User, UserSchema } from "./user.ts";
import { DateSchema } from "./dateSchema.ts";
import { z } from "zod";

export type NullableCommit = {
  user?: User | null;
  commitSha: string;
  commitTitle: string;
  commitTime: Date;
};
const GhNullableCommitSchema = z.object({
  committer: z.union([
    UserSchema.nullable(),
    z.literal(null),
    z.object({}).nullable(),
  ]),
  sha: z.string(),
  commit: z.object({
    message: z.string(),
    committer: z.object({
      date: DateSchema,
    }),
  }),
});
export const NullableCommitSchema =
  GhNullableCommitSchema.transform<NullableCommit>((data) => ({
    user: isUser(data.committer) ? data.committer : null,
    commitSha: data.sha,
    commitTitle: data.commit.message,
    commitTime: data.commit.committer.date,
  }));

export const CommitSchema = z.object({
  user: UserSchema,
  commitSha: z.string(),
  commitTitle: z.string(),
  commitTime: DateSchema,
});
export type Commit = z.infer<typeof CommitSchema>;

// Is this the best way? Need to handle {} response for committer
function isUser<T>(obj: T): obj is T & User {
  return obj && typeof obj === "object" && "id" in obj;
}
