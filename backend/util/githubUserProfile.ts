import type { GhUserProfile } from "../models/gh/userProfile.ts";
import {
  type GithubUser,
  type GithubUserProfileSnapshot,
  GithubUserProfileSnapshotSchema,
  GithubUserSchema,
} from "../../shared/models/githubUser.ts";

function normalizeGithubEmail(value: string | null | undefined): string | null {
  if (!value) return null;

  const parsed = GithubUserSchema.shape.email.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function normalizeGithubTimestamp(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

export function normalizeGithubUserProfileSnapshot(
  profile: GithubUserProfileSnapshot,
): GithubUserProfileSnapshot {
  return GithubUserProfileSnapshotSchema.parse({
    ...profile,
    github_created_at: normalizeGithubTimestamp(profile.github_created_at),
  });
}

export function toGithubUser(profile: GhUserProfile): GithubUser {
  return GithubUserSchema.parse({
    login: profile.login,
    name: profile.name,
    avatar_url: profile.avatar_url,
    company: profile.company,
    location: profile.location,
    email: normalizeGithubEmail(profile.email),
    created_at:
      normalizeGithubTimestamp(profile.created_at) ?? profile.created_at,
    html_url: profile.html_url,
  });
}

export function toGithubUserProfileSnapshot(
  profile: GhUserProfile,
): GithubUserProfileSnapshot {
  return normalizeGithubUserProfileSnapshot({
    avatar_url: profile.avatar_url,
    name: profile.name,
    company: profile.company,
    location: profile.location,
    email: normalizeGithubEmail(profile.email),
    github_created_at: profile.created_at,
  });
}

export function githubUserProfilesDiffer(
  current: GithubUserProfileSnapshot,
  incoming: GithubUserProfileSnapshot,
): boolean {
  const normalizedCurrent = normalizeGithubUserProfileSnapshot(current);
  const normalizedIncoming = normalizeGithubUserProfileSnapshot(incoming);

  return (
    normalizedCurrent.avatar_url !== normalizedIncoming.avatar_url ||
    normalizedCurrent.name !== normalizedIncoming.name ||
    normalizedCurrent.company !== normalizedIncoming.company ||
    normalizedCurrent.location !== normalizedIncoming.location ||
    normalizedCurrent.email !== normalizedIncoming.email ||
    normalizedCurrent.github_created_at !== normalizedIncoming.github_created_at
  );
}
