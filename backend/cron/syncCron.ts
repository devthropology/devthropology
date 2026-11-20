import { githubArchiveFromEnv } from "../features/githubArchive/githubArchiveService.ts";
import { Backfiller, BackfillProgress } from "../backfill/backfiller.ts";
import { GhApi } from "../api/ghApi.ts";
import { RateExceededError } from "../models/errors/RateExceededError.ts";
import { SyncApiKey } from "../models/sync/syncApiKey.ts";
import { SyncCronOutcomeCode } from "../models/syncCron/syncCronRun.ts";
import { SyncCronRepositoryWithDetails } from "../models/syncCron/syncCronRepository.ts";
import { SyncCronRepository } from "../repository/syncCronRepository.ts";
import { SqlClient } from "../repository/sqlClient.ts";
import { PostgresRepository } from "../repository/postgresRepository.ts";
import { PostgresComputedUserMetricsRepository } from "../repository/postgresComputedUserMetricsRepository.ts";
import { PostgresUserRelationshipRepository } from "../repository/postgresUserRelationshipRepository.ts";
import { UserRelationshipService } from "../services/userRelationshipService.ts";
import { TrendsRepository } from "../features/trends/trendsRepository.ts";
import { RepositoryContributorsRepository } from "../features/repositoryContributors/repositoryContributorsRepository.ts";

export interface SyncCronRunSummary {
  repository: SyncCronRepositoryWithDetails;
  outcomeCode: SyncCronOutcomeCode;
  requestedCount: number;
  processedCount: number;
  apiKeysUsed: number;
}

export async function runSyncCron(
  sql: SqlClient,
): Promise<SyncCronRunSummary[]> {
  const syncCronRepository = new SyncCronRepository(sql);
  const repositories = await syncCronRepository.getActiveRepositories();

  if (repositories.length === 0) {
    console.warn("No sync cron repositories configured; exiting early.");
    return [];
  }

  const latestRun = await syncCronRepository.getLatestRun();
  const repositoriesToRun = orderRepositoriesForRun(repositories, latestRun);
  const exhaustedApiKeys = new Set<number>();
  const summaries: SyncCronRunSummary[] = [];

  console.log(
    `Starting sync cron for ${repositoriesToRun.length} repositories.`,
  );

  for (const repository of repositoriesToRun) {
    const summary = await runRepositorySync(
      repository,
      sql,
      syncCronRepository,
      exhaustedApiKeys,
    );
    summaries.push(summary);

    if (summary.outcomeCode === "PARTIAL_RATE_LIMIT") {
      break;
    }
  }

  console.log("Sync cron completed.");
  return summaries;
}

export function orderRepositoriesForRun(
  repositories: SyncCronRepositoryWithDetails[],
  latestRun: {
    sync_cron_repository_id: number;
    outcome_code: SyncCronOutcomeCode;
  } | null,
): SyncCronRepositoryWithDetails[] {
  if (repositories.length <= 1 || latestRun === null) {
    return repositories;
  }

  const currentIndex = repositories.findIndex(
    (repository) =>
      repository.sync_cron_repository_id === latestRun.sync_cron_repository_id,
  );
  if (currentIndex === -1) {
    return repositories;
  }

  const startIndex =
    latestRun.outcome_code === "COMPLETE"
      ? (currentIndex + 1) % repositories.length
      : currentIndex;

  return [
    ...repositories.slice(startIndex),
    ...repositories.slice(0, startIndex),
  ];
}

async function runRepositorySync(
  repository: SyncCronRepositoryWithDetails,
  sql: SqlClient,
  syncCronRepository: SyncCronRepository,
  exhaustedApiKeys: Set<number>,
): Promise<SyncCronRunSummary> {
  const startedAt = new Date();
  const allowedApiKeys = await syncCronRepository.getApiKeysForRepository(
    repository.sync_cron_repository_id,
  );

  let processedCount = 0;
  let apiKeysUsed = 0;
  let nextStartIssueNumber: number | null = null;
  let outcomeCode: SyncCronOutcomeCode = "COMPLETE";

  while (processedCount < repository.batch_size) {
    const apiKey = pickNextApiKey(allowedApiKeys, exhaustedApiKeys);
    if (!apiKey) {
      outcomeCode = "PARTIAL_RATE_LIMIT";
      break;
    }

    apiKeysUsed++;
    const remainingCount = repository.batch_size - processedCount;
    const context = buildBackfiller(sql, repository, apiKey);

    try {
      console.log(
        `Running sync for ${repository.org}/${repository.name} with key ${apiKey.sync_api_key_id} for ${remainingCount} PRs${
          nextStartIssueNumber === null
            ? ""
            : ` starting at issue ${nextStartIssueNumber}`
        }`,
      );

      const progress: BackfillProgress =
        nextStartIssueNumber === null
          ? await context.backfiller.backfillFromLatestPullRequestsWithResult(
              remainingCount,
            )
          : await context.backfiller.backfillFromLatestPullRequestsStartingAt(
              nextStartIssueNumber,
              remainingCount,
            );

      processedCount += progress.processedCount;

      if (progress.hitRateLimit) {
        exhaustedApiKeys.add(apiKey.sync_api_key_id);
        nextStartIssueNumber = progress.nextStartIssueNumber;
        outcomeCode = "PARTIAL_RATE_LIMIT";
        continue;
      }

      outcomeCode = "COMPLETE";
      break;
    } catch (error) {
      if (error instanceof RateExceededError) {
        exhaustedApiKeys.add(apiKey.sync_api_key_id);
        outcomeCode = "PARTIAL_RATE_LIMIT";
        continue;
      }

      outcomeCode = "PARTIAL_ERROR";
      console.error(
        `Error during sync for ${repository.org}/${repository.name}:`,
        error,
      );
      break;
    } finally {
      await Promise.all([
        context.repository.close(),
        context.computedUserMetricsRepository.close(),
        context.userRelationshipRepository.close(),
      ]);
    }
  }

  const summary: SyncCronRunSummary = {
    repository,
    outcomeCode,
    requestedCount: repository.batch_size,
    processedCount,
    apiKeysUsed,
  };

  await syncCronRepository.insertRun({
    syncCronRepositoryId: repository.sync_cron_repository_id,
    outcomeCode: summary.outcomeCode,
    requestedCount: summary.requestedCount,
    processedCount: summary.processedCount,
    apiKeysUsed: summary.apiKeysUsed,
    startedAt,
    completedAt: new Date(),
  });

  return summary;
}

function pickNextApiKey(
  allowedApiKeys: SyncApiKey[],
  exhaustedApiKeys: Set<number>,
): SyncApiKey | null {
  return (
    allowedApiKeys.find(
      (apiKey) => !exhaustedApiKeys.has(apiKey.sync_api_key_id),
    ) ?? null
  );
}

function buildBackfiller(
  sql: SqlClient,
  repository: SyncCronRepositoryWithDetails,
  apiKey: SyncApiKey,
): {
  backfiller: Backfiller;
  repository: PostgresRepository;
  computedUserMetricsRepository: PostgresComputedUserMetricsRepository;
  userRelationshipRepository: PostgresUserRelationshipRepository;
} {
  const repo = new PostgresRepository(repository.org, repository.name, sql);
  const computedUserMetricsRepository =
    new PostgresComputedUserMetricsRepository(sql);
  const userRelationshipRepository = new PostgresUserRelationshipRepository(
    sql,
  );
  const userRelationshipService = new UserRelationshipService(
    userRelationshipRepository,
  );
  const ghApi = new GhApi(
    repository.org,
    repository.name,
    apiKey.gh_username,
    apiKey.api_key,
  );
  const backfiller = new Backfiller(ghApi, repo, {
    archive: githubArchiveFromEnv({
      owner: repository.org,
      name: repository.name,
    }),
    silent: false,
    computedUserMetricsRepository,
    userRelationshipService,
    trendsRepository: new TrendsRepository(sql),
    repositoryContributorsRepository: new RepositoryContributorsRepository(sql),
  });

  return {
    backfiller,
    repository: repo,
    computedUserMetricsRepository,
    userRelationshipRepository,
  };
}
