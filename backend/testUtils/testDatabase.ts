import { afterAll } from "vitest";
import { PostgresRepository } from "../repository/postgresRepository.ts";
import { IRepository } from "../repository/repository.ts";
import { GhApi } from "../api/ghApi.ts";
import { Backfiller } from "../backfill/backfiller.ts";
import { JsonValue, mockFetch, MockUrls } from "../test/mock_fetch.ts";
import { z } from "zod";
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import postgres from "postgres";
import { tmpdir } from "node:os";
import { readdir, readFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolveBinary } from "dbmate";
import lockfile from "proper-lockfile";
import { runCommand } from "../util/runCommand.ts";
import { join } from "node:path";
import { PostgresComputedUserMetricsRepository } from "../repository/postgresComputedUserMetricsRepository.ts";
import { PostgresUserRelationshipRepository } from "../repository/postgresUserRelationshipRepository.ts";
import { UserRelationshipService } from "../services/userRelationshipService.ts";
import { createSqlClient } from "../repository/sqlClient.ts";
import { TrendsRepository } from "../features/trends/trendsRepository.ts";
import { RepositoryContributorsRepository } from "../features/repositoryContributors/repositoryContributorsRepository.ts";

// Test data repositories to load (add more here as needed)
const TEST_REPOSITORIES = [
  {
    org: "tailscale",
    name: "tailscale",
    jsonlFile: "tailscale.jsonl",
    maxRecords: 500,
  },
];

const SEEDED_TEMPLATE_DATABASE = "test_tailscale_template";
const CLEAN_TEMPLATE_DATABASE = "test_clean_template";
const EMPTY_TEMPLATE_DATABASE = "test_empty_template";
const SEEDED_WORKER_PREFIX = "test_seeded_worker_";
const CLEAN_WORKER_PREFIX = "test_clean_worker_";
const EMPTY_WORKER_PREFIX = "test_empty_worker_";
const FIXTURE_LOCK_KEYS = [71423, 92017] as const;
// Bump when the fixture input or derived seeded data setup changes.
const SEEDED_FIXTURE_REVISION = "tailscale-v2-review-linked-rounds";
const EMPTY_TEMPLATE_REVISION = "empty-v1";

let schemaMigrationVersionPromise: Promise<string> | undefined;
let containerPromise: Promise<StartedPostgreSqlContainer> | undefined;
let seededWorkerDatabasePromise: Promise<string> | undefined;
let cleanWorkerDatabasePromise: Promise<string> | undefined;
let emptyWorkerDatabasePromise: Promise<string> | undefined;
let workerSql: ReturnType<typeof createSqlClient> | undefined;
const workerDatabaseLeases = new Map<string, ReturnType<typeof postgres>>();

afterAll(async () => {
  await workerSql?.end({ timeout: 1 });
  await Promise.all(
    [...workerDatabaseLeases.values()].map((lease) =>
      lease.end({ timeout: 1 }),
    ),
  );
  workerDatabaseLeases.clear();
});
const seededWorkerDatabaseName = workerDatabaseName(SEEDED_WORKER_PREFIX);
const cleanWorkerDatabaseName = workerDatabaseName(CLEAN_WORKER_PREFIX);
const emptyWorkerDatabaseName = workerDatabaseName(EMPTY_WORKER_PREFIX);

/**
 * Get a worker-isolated database cloned from the shared, immutable Tailscale
 * fixture. The fixture is initialized once per reusable PostgreSQL container;
 * each isolated test file receives its own database so test writes cannot race.
 */
export async function getTestDatabase(): Promise<{
  repository: IRepository;
  ghApi: GhApi;
  connectionString: string;
  computedUserMetricsRepository: PostgresComputedUserMetricsRepository;
}> {
  seededWorkerDatabasePromise ??= getSchemaMigrationVersion().then((version) =>
    createWorkerDatabase(
      SEEDED_TEMPLATE_DATABASE,
      SEEDED_WORKER_PREFIX,
      seededWorkerDatabaseName,
      `schema-${version}-${SEEDED_FIXTURE_REVISION}`,
      initializeSeededTemplate,
    ),
  );
  const connectionString = await seededWorkerDatabasePromise;
  workerSql ??= createSqlClient(connectionString);

  const testRepo = TEST_REPOSITORIES[0];
  const repository = new PostgresRepository(
    testRepo.org,
    testRepo.name,
    workerSql,
  );
  const computedUserMetricsRepository =
    new PostgresComputedUserMetricsRepository(workerSql);
  const ghApi = new GhApi(testRepo.org, testRepo.name, "testuser", "testtoken");

  return {
    repository,
    ghApi,
    connectionString,
    computedUserMetricsRepository,
  };
}

/** Get a worker-isolated database with the complete application schema migrated. */
export async function getCleanTestDatabase(): Promise<string> {
  cleanWorkerDatabasePromise ??= getSchemaMigrationVersion().then((version) =>
    createWorkerDatabase(
      CLEAN_TEMPLATE_DATABASE,
      CLEAN_WORKER_PREFIX,
      cleanWorkerDatabaseName,
      `schema-${version}`,
      runMigrations,
    ),
  );
  return await cleanWorkerDatabasePromise;
}

/** Get an empty worker-isolated PostgreSQL database for custom-schema tests. */
export async function getEmptyTestDatabase(): Promise<string> {
  emptyWorkerDatabasePromise ??= createWorkerDatabase(
    EMPTY_TEMPLATE_DATABASE,
    EMPTY_WORKER_PREFIX,
    emptyWorkerDatabaseName,
    EMPTY_TEMPLATE_REVISION,
    async () => {},
  );
  return await emptyWorkerDatabasePromise;
}

function getContainer(): Promise<StartedPostgreSqlContainer> {
  containerPromise ??= (async () => {
    // Testcontainers' reuse lock is module-local. Serialize lookup AND startup
    // across workers/worktrees using an atomic mkdir lock with a heartbeat.
    // A crashed worker's lock becomes stale rather than blocking future runs.
    const release = await lockfile.lock(
      join(tmpdir(), "devthropology-postgres-test-container-startup"),
      {
        realpath: false,
        stale: 60_000,
        retries: { forever: true, minTimeout: 100, maxTimeout: 1000 },
      },
    );
    try {
      return await new PostgreSqlContainer("postgres:17-alpine")
        .withCommand(["postgres", "-c", "fsync=off"])
        .withTmpFs({ "/var/lib/postgresql/data": "rw" })
        .withReuse()
        .start();
    } finally {
      await release();
    }
  })();
  return containerPromise;
}

async function createWorkerDatabase(
  templateName: string,
  workerPrefix: string,
  databaseName: string,
  templateRevision: string,
  initialize: (connectionString: string) => Promise<void>,
): Promise<string> {
  if (!databaseName.startsWith(workerPrefix)) {
    throw new Error(`Test database name must start with ${workerPrefix}`);
  }

  const container = await getContainer();
  const baseConnectionString = container.getConnectionUri();
  const adminSql = createSqlClient(
    connectionStringForDatabase(baseConnectionString, "postgres"),
  );
  // Run all admin queries on the reserved connection so setup also works with
  // PG_POOL_MAX=1 while retaining the session-level advisory lock.
  const lock = await adminSql.reserve();
  const start = performance.now();

  try {
    await lock`SELECT pg_advisory_lock(${FIXTURE_LOCK_KEYS[0]}, ${
      FIXTURE_LOCK_KEYS[1]
    })`;
    try {
      await ensureTemplate(
        lock,
        baseConnectionString,
        templateName,
        templateRevision,
        initialize,
      );
      await removeInactiveWorkerDatabases(lock);
      await lock.unsafe(
        `CREATE DATABASE "${databaseName}" WITH TEMPLATE "${templateName}"`,
      );

      const connectionString = connectionStringForDatabase(
        baseConnectionString,
        databaseName,
      );
      // Keep a live connection while this worker runs. Other workers use it to
      // distinguish active databases from stale clones left by an interrupted run.
      const lease = postgres(connectionString, {
        max: 1,
        idle_timeout: 0,
        max_lifetime: 0,
        connect_timeout: 3,
      });
      workerDatabaseLeases.set(databaseName, lease);
      await lease`SELECT 1`;
      console.log(
        `✅ PostgreSQL test database ready: ${databaseName} (${(
          performance.now() - start
        ).toFixed(1)}ms)`,
      );
      return connectionString;
    } finally {
      await lock`SELECT pg_advisory_unlock(${FIXTURE_LOCK_KEYS[0]}, ${
        FIXTURE_LOCK_KEYS[1]
      })`;
    }
  } finally {
    lock.release();
    await adminSql.end({ timeout: 1 });
  }
}

async function ensureTemplate(
  adminSql: postgres.ReservedSql,
  baseConnectionString: string,
  templateName: string,
  templateRevision: string,
  initialize: (connectionString: string) => Promise<void>,
) {
  const readyMarker = `devthropology-test-template:${templateName}:${templateRevision}`;
  const databases = await adminSql<{ comment: string | null }[]>`
    SELECT shobj_description(oid, 'pg_database') AS comment
    FROM pg_database
    WHERE datname = ${templateName}
  `;
  if (databases[0]?.comment === readyMarker) return;

  if (databases.length > 0) {
    await adminSql.unsafe(`DROP DATABASE "${templateName}" WITH (FORCE)`);
  }
  await adminSql.unsafe(`CREATE DATABASE "${templateName}"`);

  try {
    await initialize(
      connectionStringForDatabase(baseConnectionString, templateName),
    );
    await adminSql.unsafe(
      `COMMENT ON DATABASE "${templateName}" IS '${readyMarker}'`,
    );
    console.log(`✅ PostgreSQL test template initialized: ${templateName}`);
  } catch (error) {
    await adminSql.unsafe(`DROP DATABASE "${templateName}" WITH (FORCE)`);
    throw error;
  }
}

async function initializeSeededTemplate(connectionString: string) {
  const start = performance.now();
  await runMigrations(connectionString);

  const sql = createSqlClient(connectionString);
  try {
    const testRepo = TEST_REPOSITORIES[0];
    const repository = new PostgresRepository(testRepo.org, testRepo.name, sql);
    const computedUserMetricsRepository =
      new PostgresComputedUserMetricsRepository(sql);
    const userRelationshipRepository = new PostgresUserRelationshipRepository(
      sql,
    );
    const ghApi = new GhApi(
      testRepo.org,
      testRepo.name,
      "testuser",
      "testtoken",
    );

    await loadTestData(
      testRepo.jsonlFile,
      testRepo.org,
      testRepo.name,
      testRepo.maxRecords,
    );

    const backfiller = new Backfiller(ghApi, repository, {
      silent: true,
      computedUserMetricsRepository,
      userRelationshipService: new UserRelationshipService(
        userRelationshipRepository,
      ),
      trendsRepository: new TrendsRepository(sql),
      repositoryContributorsRepository: new RepositoryContributorsRepository(
        sql,
      ),
    });
    await backfiller.backfillFromLatest(testRepo.maxRecords);
    console.log(
      `✅ Tailscale fixture loaded (${(performance.now() - start).toFixed(
        1,
      )}ms)`,
    );
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function removeInactiveWorkerDatabases(adminSql: postgres.ReservedSql) {
  const staleDatabases = await adminSql<{ datname: string }[]>`
    SELECT d.datname
    FROM pg_database d
    WHERE (
      LEFT(d.datname, LENGTH(${SEEDED_WORKER_PREFIX})) = ${SEEDED_WORKER_PREFIX}
      OR LEFT(d.datname, LENGTH(${CLEAN_WORKER_PREFIX})) = ${CLEAN_WORKER_PREFIX}
      OR LEFT(d.datname, LENGTH(${EMPTY_WORKER_PREFIX})) = ${EMPTY_WORKER_PREFIX}
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_stat_activity a WHERE a.datname = d.datname
    )
  `;

  for (const { datname } of staleDatabases) {
    if (!/^test_(seeded|clean|empty)_worker_[a-zA-Z0-9_]+$/.test(datname)) {
      continue;
    }
    try {
      // Never terminate connections that appeared after the inactivity check.
      await adminSql.unsafe(`DROP DATABASE "${datname}"`);
    } catch (error) {
      if (error instanceof postgres.PostgresError && error.code === "55006") {
        continue; // object_in_use: a worker reconnected; leave its database alone.
      }
      throw error;
    }
  }
}

function getSchemaMigrationVersion(): Promise<string> {
  schemaMigrationVersionPromise ??= (async () => {
    const directory = new URL(
      "../schema_migrations/postgres/",
      import.meta.url,
    );
    const filenames: string[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isFile() && /^\d+_.*\.sql$/.test(entry.name)) {
        filenames.push(entry.name);
      }
    }
    filenames.sort();
    if (filenames.length === 0) {
      throw new Error("No PostgreSQL migration files found for test templates");
    }
    // Include names and contents, not just the newest timestamp: edits, removed
    // migrations, and branch switches must invalidate both schema templates.
    const migrations: [string, string][] = [];
    for (const filename of filenames) {
      migrations.push([
        filename,
        await readFile(new URL(filename, directory), "utf8"),
      ]);
    }
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(migrations)),
    );
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  })();
  return schemaMigrationVersionPromise;
}

function workerDatabaseName(prefix: string): string {
  return `${prefix}${process.pid}_${crypto
    .randomUUID()
    .replaceAll("-", "")
    .slice(0, 12)}`;
}

function connectionStringForDatabase(
  connectionString: string,
  databaseName: string,
): string {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

export async function runMigrations(connectionString: string) {
  const start = performance.now();
  const { code, success, stderr } = await runCommand(
    resolveBinary(),
    ["--env", "DATABASE_URL_PG_DBMATE", "up"],
    {
      env: {
        DATABASE_URL_PG_DBMATE: connectionString + "?sslmode=disable",
        DBMATE_NO_DUMP_SCHEMA: "1",
        DBMATE_MIGRATIONS_DIR: fileURLToPath(
          new URL("../schema_migrations/postgres/", import.meta.url),
        ),
      },
    },
  );
  const elapsed = (performance.now() - start).toFixed(1);

  if (!success) {
    console.error("❌ PostgreSQL migration failed:");
    console.error(stderr);
    throw new Error(`Migration failed with exit code ${code}`);
  }

  console.log(`✅ PostgreSQL schema migrations completed (${elapsed}ms)`);
}

async function loadTestData(
  filePath: string,
  org: string,
  repo: string,
  number: number,
) {
  const lineSchema = z.record(
    z.string().transform((key: string) => Number(key)),
    z.array(
      z.object({
        endpoint: z.string(),
        response: z.unknown(),
        status: z.number(),
      }),
    ),
  );

  type ParsedLine = z.infer<typeof lineSchema>;
  type MockResponseData = {
    endpoint: string;
    response: unknown;
    status: number;
  };

  const mockUrls: MockUrls = {};
  const fileContent = await readFile(filePath, "utf8");
  const lines = fileContent.split("\n").filter(Boolean);

  lines.forEach((line) => {
    const parsed: ParsedLine = lineSchema.parse(JSON.parse(line));
    Object.values(parsed)
      .flat()
      .forEach((rawData) => {
        const data = rawData as MockResponseData;
        mockUrls[data.endpoint] = {
          body: data.response as JsonValue,
          status: data.status,
        };
      });
  });

  // Add required mock endpoints
  mockUrls["https://api.github.com/rate_limit"] = {
    body: {
      rate: {
        limit: 5000,
        used: 0,
        remaining: 5000,
        reset: Math.floor(Date.now() / 1000) + 90,
      },
    },
    status: 200,
  };

  mockUrls[
    `https://api.github.com/repos/${org}/${repo}/issues?per_page=1&page=1&direction=desc&state=all`
  ] = {
    body: [{ number: number }],
    status: 200,
  };

  mockFetch(mockUrls);
}
