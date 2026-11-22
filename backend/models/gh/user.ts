import { z } from "zod";

export type User = z.infer<typeof UserSchema>;
export const UserSchema = z.object({
  id: z.number(),
  email: z.string().optional(),
  login: z.string(),
  type: z.string().nullish(),
});

export const GHOST_USER: User = {
  id: 10137,
  login: "ghost",
};

export const UNKNOWN_USER: User = {
  id: -1,
  login: "unknown.",
};

// Older archived payloads have no type. Only those retain the legacy fallback.
export function isGithubBot(
  user: Pick<User, "login" | "type"> | null | undefined,
): boolean {
  if (user == null) return false;
  return user.type != null ? user.type === "Bot" : user.login.includes("[bot]");
}
