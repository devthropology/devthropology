import type { RepositoryDetails } from "~/routes/types";

export function sortRepositories(repositories: RepositoryDetails[]): RepositoryDetails[] {
  return [...repositories].sort(
    (a, b) => a.org.localeCompare(b.org) || a.name.localeCompare(b.name),
  );
}

export function chooseBestRepository(
  repositories: RepositoryDetails[],
  ...preferredRepositoryIds: Array<string | null | undefined>
): RepositoryDetails | null {
  const sortedRepositories = sortRepositories(repositories);

  for (const repositoryId of preferredRepositoryIds) {
    if (repositoryId == null) {
      continue;
    }

    const matchingRepository = sortedRepositories.find(
      (repository) => repository.id === repositoryId,
    );
    if (matchingRepository) {
      return matchingRepository;
    }
  }

  return sortedRepositories[0] ?? null;
}
