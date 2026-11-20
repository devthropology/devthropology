import { z } from "zod";

export const GithubLoginErrorCodeSchema = z.enum([
  "not_configured",
  "invalid_state",
  "denied",
  "provider_failed",
  "account_unavailable",
  "unavailable",
]);

export type GithubLoginErrorCode = z.infer<typeof GithubLoginErrorCodeSchema>;

export function parseGithubLoginErrorCode(
  value: unknown,
): GithubLoginErrorCode {
  const result = GithubLoginErrorCodeSchema.safeParse(value);
  return result.success ? result.data : "unavailable";
}
