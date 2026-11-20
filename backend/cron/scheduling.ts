import { SyncRepositoryWithDetails } from "../models/sync/syncRepository.ts";
import { SyncApiKey } from "../models/sync/syncApiKey.ts";

export interface SyncJobPlan {
  target: SyncRepositoryWithDetails;
  apiKey: SyncApiKey;
  usageNumber: number;
  usageTotal: number;
}

export function buildSyncJobs(
  repositories: SyncRepositoryWithDetails[],
  apiKeys: SyncApiKey[],
): SyncJobPlan[] {
  if (repositories.length === 0 || apiKeys.length === 0) {
    return [];
  }

  const jobs: SyncJobPlan[] = [];
  let apiKeyIndex = 0;

  for (const repository of repositories) {
    if (repository.mode_code === "LAST_SEEN") {
      for (let usage = 0; usage < apiKeys.length; usage++) {
        const key = apiKeys[(apiKeyIndex + usage) % apiKeys.length];
        jobs.push({
          target: repository,
          apiKey: key,
          usageNumber: usage + 1,
          usageTotal: apiKeys.length,
        });
      }
      apiKeyIndex = (apiKeyIndex + 1) % apiKeys.length;
    } else {
      const key = apiKeys[apiKeyIndex % apiKeys.length];
      jobs.push({
        target: repository,
        apiKey: key,
        usageNumber: 1,
        usageTotal: 1,
      });
      apiKeyIndex = (apiKeyIndex + 1) % apiKeys.length;
    }
  }

  return jobs;
}
