import { API_URL, authenticatedFetch } from "../config";
import type { RepositoryDetails } from "../routes/types";

type RawRepository = {
  id: string;
  name: string;
  org: string;
  last_sync_at?: string | null;
};

function isRawRepository(value: unknown): value is RawRepository {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.org === "string" &&
    (candidate.last_sync_at === undefined ||
      candidate.last_sync_at === null ||
      typeof candidate.last_sync_at === "string")
  );
}

export async function fetchRepositoriesWithRetry(
  token: string,
  options?: { request?: Request },
): Promise<RepositoryDetails[]> {
  const response = await authenticatedFetch(`${API_URL}/api/repository`, token, {
    ...options,
    label: "app.repositories",
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch repository details: ${response.status} ${response.statusText}`,
    );
  }

  const rawRepositories: unknown = await response.json();
  if (!Array.isArray(rawRepositories)) {
    throw new Error("Repository response was not an array");
  }

  return rawRepositories.map((repo) => {
    if (!isRawRepository(repo)) {
      throw new Error("Repository response contained invalid data");
    }

    return {
      id: repo.id,
      name: repo.name,
      org: repo.org,
      lastSyncAt: repo.last_sync_at ?? null,
    } satisfies RepositoryDetails;
  });
}
