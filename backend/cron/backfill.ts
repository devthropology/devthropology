import { githubArchiveFromEnv } from "../features/githubArchive/githubArchiveService.ts";
import process, { env } from "node:process";
import { loadEnv } from "../util/loadEnv.ts";
import { Backfiller } from "../backfill/backfiller.ts";
import { GhApi } from "../api/ghApi.ts";
import { PostgresRepository } from "../repository/postgresRepository.ts";
import { PostgresComputedUserMetricsRepository } from "../repository/postgresComputedUserMetricsRepository.ts";
import { PostgresUserRelationshipRepository } from "../repository/postgresUserRelationshipRepository.ts";
import { UserRelationshipService } from "../services/userRelationshipService.ts";
import { SyncRepository as SyncMetadataRepository } from "../repository/syncRepository.ts";
import { getSharedSqlClient } from "../repository/sqlClient.ts";
import { SyncRepositoryWithDetails } from "../models/sync/syncRepository.ts";
import { buildSyncJobs } from "./scheduling.ts";
import { sleep } from "../util/sleep.ts";
import { TrendsRepository } from "../features/trends/trendsRepository.ts";
import { RepositoryContributorsRepository } from "../features/repositoryContributors/repositoryContributorsRepository.ts";

await loadEnv();

const pgUrl = env.DATABASE_URL_PG;
if (!pgUrl) {
  console.error("DATABASE_URL_PG must be configured for the sync cron.");
  process.exit(1);
}

const syncSql = getSharedSqlClient(pgUrl);
const syncRepository = new SyncMetadataRepository(syncSql);

let retries = 0;
const maxRetries = 3;
let success = false;

while (retries < maxRetries && !success) {
  try {
    await runCron(syncRepository, pgUrl);
    success = true;
  } catch (error) {
    retries++;

    // Check if this is a connection-related error
    const errorObj = error as {
      code?: string;
      message?: string;
      name?: string;
    };
    const isConnectionError =
      errorObj?.code === "ECONNREFUSED" ||
      errorObj?.code === "57P03" || // Postgres "the database system is starting up"
      errorObj?.message?.includes("connect ECONNREFUSED") ||
      errorObj?.message?.includes("the database system is starting up");

    if (isConnectionError && retries < maxRetries) {
      const backoffMs = 5000 + retries * 2000 + Math.random() * 1000; // 5s + 2s per retry + jitter
      console.log(
        `Database connection failed (attempt ${retries}/${maxRetries}), retrying in ${Math.round(
          backoffMs,
        )}ms...`,
      );
      await sleep(backoffMs);
    } else {
      // Either not a connection error or we've exhausted retries
      console.error("Unexpected error running sync cron:", error);
      await syncRepository.close();
      process.exit(1);
    }
  }
}

if (!success) {
  console.error("Failed to run sync cron after ${maxRetries} attempts");
  await syncRepository.close();
  process.exit(1);
}

await syncRepository.close();

async function runCron(
  syncRepository: SyncMetadataRepository,
  connectionString: string,
): Promise<void> {
  const apiKeys = await syncRepository.getActiveApiKeys();
  if (apiKeys.length === 0) {
    console.warn("No active sync API keys found; exiting early.");
    return;
  }

  const repositoriesToSync = await syncRepository.getRepositoriesToSync();
  if (repositoriesToSync.length === 0) {
    console.warn("No repositories configured for sync; exiting early.");
    return;
  }

  console.log(
    `Starting sync cron for ${repositoriesToSync.length} repositories using ${apiKeys.length} API keys.`,
  );

  const jobs = buildSyncJobs(repositoriesToSync, apiKeys);
  for (const job of jobs) {
    await runSyncForRepository(job.target, job.apiKey.api_key, {
      ghUsername: job.apiKey.gh_username,
      syncRepository,
      connectionString,
      syncApiKeyId: job.apiKey.sync_api_key_id,
      apiKeySuffix: job.apiKey.api_key.slice(-4),
      usageNumber: job.usageNumber,
      usageTotal: job.usageTotal,
    });
  }

  console.log("Sync cron completed.");
}

interface SyncContext {
  ghUsername: string;
  syncRepository: SyncMetadataRepository;
  connectionString: string;
  syncApiKeyId: number;
  apiKeySuffix: string;
  usageNumber: number;
  usageTotal: number;
}

async function runSyncForRepository(
  target: SyncRepositoryWithDetails,
  token: string,
  context: SyncContext,
): Promise<void> {
  const startedAt = new Date();
  const {
    ghUsername,
    connectionString,
    syncRepository,
    syncApiKeyId,
    apiKeySuffix,
    usageNumber,
    usageTotal,
  } = context;

  console.log(
    `Running sync for ${target.org}/${target.name} with mode ${target.mode_code} using key ${syncApiKeyId} (…${apiKeySuffix}) [${usageNumber}/${usageTotal}]`,
  );

  const sql = getSharedSqlClient(connectionString);
  const repository = new PostgresRepository(target.org, target.name, sql);
  const computedUserMetricsRepository =
    new PostgresComputedUserMetricsRepository(sql);
  const userRelationshipRepository = new PostgresUserRelationshipRepository(
    sql,
  );
  const userRelationshipService = new UserRelationshipService(
    userRelationshipRepository,
  );
  const ghApi = new GhApi(target.org, target.name, ghUsername, token);
  const backfiller = new Backfiller(ghApi, repository, {
    archive: githubArchiveFromEnv({ owner: target.org, name: target.name }),
    silent: false,
    computedUserMetricsRepository,
    userRelationshipService,
    trendsRepository: new TrendsRepository(sql),
    repositoryContributorsRepository: new RepositoryContributorsRepository(sql),
  });

  try {
    await runBackfill(backfiller, target);
    const completedAt = new Date();
    const durationSeconds = Math.max(
      1,
      Math.round((completedAt.getTime() - startedAt.getTime()) / 1000),
    );

    await syncRepository.insertSyncJob({
      repositoryId: target.repository_id,
      syncModeCode: target.mode_code,
      syncApiKeyId,
      durationSeconds,
      startedAt,
      completedAt,
    });
  } catch (error) {
    console.error(`Error during sync for ${target.org}/${target.name}:`, error);
    await syncRepository.insertSyncJob({
      repositoryId: target.repository_id,
      syncModeCode: target.mode_code,
      syncApiKeyId,
      durationSeconds: null,
      startedAt,
      completedAt: new Date(),
    });
  } finally {
    await Promise.all([
      repository.close(),
      computedUserMetricsRepository.close(),
    ]);
  }
}

async function runBackfill(
  backfiller: Backfiller,
  target: SyncRepositoryWithDetails,
): Promise<void> {
  const limit = target.num_to_sync;

  if (
    target.mode_code === "LAST_SEEN" &&
    typeof backfiller.backfillFromLastProcessed === "function"
  ) {
    await backfiller.backfillFromLastProcessed(limit);
    return;
  }

  if (
    target.mode_code === "LATEST_PULL_REQUESTS" &&
    typeof backfiller.backfillFromLatestPullRequests === "function"
  ) {
    await backfiller.backfillFromLatestPullRequests(limit);
    return;
  }

  await backfiller.backfillFromLatest(limit);
}
