import { useLocation } from "react-router";

const REPO_SCOPED_PATH_PATTERN = /^\/app\/r\/([^/]+)(\/.*)?$/;

export function matchRepoScopedPath(pathname: string): {
  repoRef: string;
  suffix: string;
} | null {
  const match = pathname.match(REPO_SCOPED_PATH_PATTERN);
  if (!match) {
    return null;
  }

  return {
    repoRef: decodeURIComponent(match[1]),
    suffix: match[2] ?? "",
  };
}

export function buildRepoScopedPath(repoRef: string, suffix = ""): string {
  const normalizedSuffix = suffix ? (suffix.startsWith("/") ? suffix : `/${suffix}`) : "";

  return `/app/r/${encodeURIComponent(repoRef)}${normalizedSuffix}`;
}

export function replaceRepoRefInPath(pathname: string, repoRef: string): string | null {
  const match = matchRepoScopedPath(pathname);
  if (!match) {
    return null;
  }

  return buildRepoScopedPath(repoRef, match.suffix);
}

export function buildContributorPath(username: string, repoRef?: string): string {
  const encodedUsername = encodeURIComponent(username);
  return repoRef
    ? buildRepoScopedPath(repoRef, `/explore/contributors/${encodedUsername}`)
    : "/app";
}

export function useCurrentRepoRef(): string | null {
  const location = useLocation();
  return matchRepoScopedPath(location.pathname)?.repoRef ?? null;
}
