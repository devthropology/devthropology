import { z } from "zod";

export type User = z.infer<typeof UserSchema>;
export const UserSchema = z.object({
  id: z.number(),
  email: z.string().optional(),
  login: z.string(),
});

export const GHOST_USER: User = {
  id: 10137,
  login: "ghost",
};

export const UNKNOWN_USER: User = {
  id: -1,
  login: "unknown.",
};
