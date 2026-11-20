import { GHOST_USER, UserSchema } from "./user.ts";
import { DateSchema } from "./dateSchema.ts";
import { z } from "zod";
import { AuthorAssociation } from "./authorAssociation.ts";

export enum ReviewState {
  APPROVED = "APPROVED",
  CHANGES_REQUESTED = "CHANGES_REQUESTED",
  COMMENTED = "COMMENTED",
  DISMISSED = "DISMISSED",
  PENDING = "PENDING",
}

export type Review = z.infer<typeof ReviewSchema>;
export const ReviewSchema = z
  .object({
    id: z.number(),
    commit_id: z.string().nullish(),
    // If a github account is deleted, this is null
    user: UserSchema.nullable(),
    body: z.string(),
    state: z.nativeEnum(ReviewState),
    author_association: z.nativeEnum(AuthorAssociation),
    // For "pending", there is no date
    submitted_at: DateSchema.optional(),
  })
  .transform((review) => {
    if (review.user == null) {
      review.user = GHOST_USER;
    }
    return review;
  });
