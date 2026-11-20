import { z } from "zod";

export const GhUserProfileSchema = z.object({
  login: z.string(),
  name: z.string().nullable(),
  avatar_url: z.string().url(),
  company: z.string().nullable(),
  location: z.string().nullable(),
  created_at: z.string(),
  bio: z.string().nullable().optional(),
  blog: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  twitter_username: z.string().nullable().optional(),
  html_url: z.string().url(),
});

export type GhUserProfile = z.infer<typeof GhUserProfileSchema>;
