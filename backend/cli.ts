import { githubArchiveFromEnv } from "./features/githubArchive/githubArchiveService.ts";
import process, { env } from "node:process";
import {
  type BackfillOptions,
  createCli,
  type CreateUserOptions,
  type EnhancedStatsOptions,
  normalizeCliArgs,
} from "./cli/commands.ts";
import { Backfiller } from "./backfill/backfiller.ts";
import { GhApi } from "./api/ghApi.ts";
import { PostgresRepository } from "./repository/postgresRepository.ts";
import { createSqlClient, resolveDatabaseUrl } from "./repository/sqlClient.ts";
import { PostgresComputedUserMetricsRepository } from "./repository/postgresComputedUserMetricsRepository.ts";
import { PostgresUserRelationshipRepository } from "./repository/postgresUserRelationshipRepository.ts";
import { PostgresAuthRepository } from "./repository/postgresAuthRepository.ts";
import { AuthenticationIdentityService } from "./services/authenticationIdentityService.ts";
import { UserRelationshipService } from "./services/userRelationshipService.ts";
import { loadEnv } from "./util/loadEnv.ts";
import { PostgresBackfillRepository } from "./repository/postgresBackfillRepository.ts";
import { EnhancedStatsBackfiller } from "./backfill/enhancedStatsBackfiller.ts";
import { RepositoryRepository } from "./repository/repositoryRepository.ts";
import { runSyncCron } from "./cron/syncCron.ts";
import { isTransientDatabaseConnectionError } from "./util/isTransientDatabaseConnectionError.ts";
import { sleep } from "./util/sleep.ts";
import { TrendsRepository } from "./features/trends/trendsRepository.ts";

await loadEnv();

type BackfillContext = {
  backfiller: Backfiller;
  cleanup: () => Promise<void>;
};

type AuthContext = {
  identityService: AuthenticationIdentityService;
  cleanup: () => Promise<void>;
};

type EnhancedStatsBackfillContext = {
  backfiller: EnhancedStatsBackfiller;
  repositoryRepository: RepositoryRepository;
  cleanup: () => Promise<void>;
};

function parseRepo(repo: string): { org: string; repoName: string } {
  const [org, repoName] = repo.split("/");
  if (!org || !repoName) {
    console.error("Repository must be provided as org/repo");
    process.exit(1);
  }

  return { org, repoName };
}

function getBackfillContext(
  repo: string,
  username: string,
  databaseUrl: string | undefined,
  ghToken: string,
): BackfillContext {
  const orgName = repo.split("/")[0];
  const repoName = repo.split("/")[1];
  const connectionString = databaseUrl ?? env.DATABASE_URL_PG;

  if (!connectionString) {
    console.error(
      "DATABASE_URL_PG must be provided via --databaseUrl or environment variable",
    );
    process.exit(1);
  }

  const sql = createSqlClient(connectionString);
  const repoInstance = new PostgresRepository(orgName, repoName, sql);
  const computedUserMetricsRepository =
    new PostgresComputedUserMetricsRepository(sql);
  const userRelationshipRepository = new PostgresUserRelationshipRepository(
    sql,
  );
  const userRelationshipService = new UserRelationshipService(
    userRelationshipRepository,
  );
  const api = new GhApi(orgName, repoName, username, ghToken);

  const backfiller = new Backfiller(api, repoInstance, {
    archive: githubArchiveFromEnv({ owner: orgName, name: repoName }),
    computedUserMetricsRepository,
    userRelationshipService,
    trendsRepository: new TrendsRepository(sql),
  });

  const cleanup = async () => {
    await Promise.all([
      repoInstance.close(),
      computedUserMetricsRepository.close(),
      sql.end({ timeout: 1 }),
    ]);
  };

  return { backfiller, cleanup };
}

function getAuthContext(): AuthContext {
  const connectionString = resolveDatabaseUrl();

  if (!connectionString) {
    console.error("DATABASE_URL_PG must be provided via environment variable");
    process.exit(1);
  }

  const passwordPepper = env.AUTH_PASSWORD_PEPPER;
  if (!passwordPepper) {
    console.error(
      "AUTH_PASSWORD_PEPPER must be provided via environment variable",
    );
    process.exit(1);
  }

  const sql = createSqlClient(connectionString);
  const authRepository = new PostgresAuthRepository(sql);
  const identityService = new AuthenticationIdentityService(authRepository, {
    passwordPepper,
  });

  const cleanup = async () => {
    await Promise.all([authRepository.close(), sql.end({ timeout: 1 })]);
  };

  return { identityService, cleanup };
}

function getEnhancedStatsBackfillContext(
  databaseUrl: string | undefined,
): EnhancedStatsBackfillContext {
  const connectionString = databaseUrl ?? env.DATABASE_URL_PG;

  if (!connectionString) {
    console.error(
      "DATABASE_URL_PG must be provided via --databaseUrl or environment variable",
    );
    process.exit(1);
  }

  const sql = createSqlClient(connectionString);
  const backfillRepository = new PostgresBackfillRepository(sql);
  const repositoryRepository = new RepositoryRepository(sql);
  const backfiller = new EnhancedStatsBackfiller(backfillRepository);

  const cleanup = async () => {
    await sql.end({ timeout: 1 });
  };

  return { backfiller, repositoryRepository, cleanup };
}

async function backfill(options: BackfillOptions, users: string[]) {
  const { all, allLastSeen, repo, username, databaseUrl, ghToken } = options;
  const { backfiller, cleanup } = getBackfillContext(
    repo,
    username,
    databaseUrl,
    ghToken,
  );

  try {
    if (all) {
      console.log(`Backfilling all data for repo ${repo}...`);
      await backfiller.backfillFromLatest(2000);
      return;
    }

    if (allLastSeen) {
      console.log(
        `Backfilling all data for repo ${repo} starting with last seen...`,
      );
      await backfiller.backfillFromLastProcessed(2000);
      return;
    }

    console.log(
      `Backfilling data for users ${users.join(", ")} for repo ${repo}...`,
    );
    await backfiller.forUsers(...users);
  } finally {
    await cleanup();
  }
}

async function createUser(options: CreateUserOptions) {
  const { username, password, role, printToken } = options;
  const { identityService, cleanup } = getAuthContext();

  try {
    const user = await identityService.createUser(username, password, role);
    console.log(`Created user ${user.username} with role ${user.role}`);

    if (printToken) {
      const login = await identityService.authenticateWithPassword(
        username,
        password,
      );
      if (!login) {
        console.error("Unable to authenticate newly created user.");
        process.exit(1);
      }
      console.log(`Bearer token: ${login.token}`);
    }
  } catch (error) {
    console.error("Unable to create user:", error);
    process.exit(1);
  } finally {
    await cleanup();
  }
}

async function enhancedStats(options: EnhancedStatsOptions) {
  const { repo, allRepositories, databaseUrl } = options;

  if (!repo && !allRepositories) {
    console.error("Provide either --repo org/repo or --all-repositories");
    process.exit(1);
  }

  if (repo && allRepositories) {
    console.error("Use either --repo or --all-repositories, not both");
    process.exit(1);
  }

  const { backfiller, repositoryRepository, cleanup } =
    getEnhancedStatsBackfillContext(databaseUrl);
  let exitCode = 0;

  try {
    if (repo) {
      const { org, repoName } = parseRepo(repo);
      await backfiller.backfill(org, repoName);
      return;
    }

    const repositories = await repositoryRepository.getAllRepositories();
    if (repositories.length === 0) {
      console.log("No repositories found in database.");
      return;
    }

    console.log(
      `Running enhanced PR stats backfill for ${repositories.length} repositories...`,
    );

    const failedRepositories: string[] = [];

    for (const [index, repository] of repositories.entries()) {
      const repoSlug = `${repository.org}/${repository.name}`;
      console.log(`\n[${index + 1}/${repositories.length}] ${repoSlug}`);

      try {
        await backfiller.backfill(repository.org, repository.name);
      } catch (error) {
        failedRepositories.push(repoSlug);
        const message =
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error);
        console.error(`Failed enhanced PR stats backfill for ${repoSlug}`);
        console.error(message);
      }
    }

    console.log(
      `Enhanced PR stats batch backfill complete: succeeded=${
        repositories.length - failedRepositories.length
      } failed=${failedRepositories.length}`,
    );

    if (failedRepositories.length > 0) {
      console.error(`Failed repositories: ${failedRepositories.join(", ")}`);
      exitCode = 1;
    }
  } finally {
    await cleanup();
  }

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

async function syncCron(options: { databaseUrl?: string }) {
  const connectionString = options.databaseUrl ?? env.DATABASE_URL_PG;

  if (!connectionString) {
    console.error(
      "DATABASE_URL_PG must be provided via --databaseUrl or environment variable",
    );
    process.exit(1);
  }

  const sql = createSqlClient(connectionString);
  let exitCode = 0;
  const maxAttempts = 4;

  try {
    let summaries = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        summaries = await runSyncCron(sql);
        break;
      } catch (error) {
        const hasAttemptsRemaining = attempt < maxAttempts;

        if (
          !isTransientDatabaseConnectionError(error) ||
          !hasAttemptsRemaining
        ) {
          throw error;
        }

        const backoffMs = attempt * 1000 + Math.round(Math.random() * 250);
        console.warn(
          `Database not ready for sync-cron (attempt ${attempt}/${maxAttempts}); retrying in ${backoffMs}ms...`,
        );
        await sleep(backoffMs);
      }
    }

    if (summaries === null) {
      throw new Error("Sync cron did not produce a result after retries");
    }

    for (const summary of summaries) {
      console.log(
        `${summary.repository.org}/${summary.repository.name}: ${summary.outcomeCode} processed=${summary.processedCount}/${summary.requestedCount} apiKeysUsed=${summary.apiKeysUsed}`,
      );
    }
  } catch (error) {
    exitCode = 1;
    console.error("Sync cron failed:", error);
  } finally {
    await sql.end({ timeout: 1 });
  }

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

if (import.meta.main) {
  await createCli({ backfill, createUser, enhancedStats, syncCron }).parseAsync(
    normalizeCliArgs(process.argv.slice(2)),
    { from: "user" },
  );
}
