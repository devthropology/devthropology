import { z } from "zod";

export const GithubUserSchema = z.object({
  login: z.string(),
  name: z.string().nullable(),
  avatar_url: z.string().url(),
  company: z.string().nullable(),
  location: z.string().nullable(),
  email: z.string().email().nullable(),
  created_at: z.string(),
  html_url: z.string().url(),
});

export const GithubUserProfileSnapshotSchema = z.object({
  avatar_url: z.string().url().nullable(),
  name: z.string().nullable(),
  company: z.string().nullable(),
  location: z.string().nullable(),
  email: z.string().email().nullable(),
  github_created_at: z.string().nullable(),
});

export type GithubUser = z.infer<typeof GithubUserSchema>;
export type GithubUserProfileSnapshot = z.infer<
  typeof GithubUserProfileSnapshotSchema
>;
