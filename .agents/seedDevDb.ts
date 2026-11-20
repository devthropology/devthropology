import { readFile } from "node:fs/promises";
import process, { env } from "node:process";
import { z } from "zod";
import { GhApi } from "../backend/api/ghApi.ts";
import { Backfiller } from "../backend/backfill/backfiller.ts";
import { RepositoryContributorsRepository } from "../backend/features/repositoryContributors/repositoryContributorsRepository.ts";
import { TrendsRepository } from "../backend/features/trends/trendsRepository.ts";
import { PostgresComputedUserMetricsRepository } from "../backend/repository/postgresComputedUserMetricsRepository.ts";
import { PostgresRepository } from "../backend/repository/postgresRepository.ts";
import { PostgresUserRelationshipRepository } from "../backend/repository/postgresUserRelationshipRepository.ts";
import { createSqlClient } from "../backend/repository/sqlClient.ts";
import { UserRelationshipService } from "../backend/services/userRelationshipService.ts";
import { JsonValue, mockFetch, MockUrls } from "../backend/test/mock_fetch.ts";
import { loadEnv } from "../backend/util/loadEnv.ts";

const ORG = "tailscale";
const REPO = "tailscale";
const JSONL_FILE = "tailscale.jsonl";
const MAX_RECORDS = 500;

const lineSchema = z.record(
  z.string().transform((key) => Number(key)),
  z.array(
    z.object({
      endpoint: z.string(),
      response: z.unknown(),
      status: z.number(),
    }),
  ),
);

async function installFixtureFetch(): Promise<void> {
  const mockUrls: MockUrls = {};
  const fileContent = await readFile(JSONL_FILE, "utf8");
  for (const line of fileContent.split("\n")) {
    if (!line) continue;
    const parsed = lineSchema.parse(JSON.parse(line));
    for (const entry of Object.values(parsed).flat()) {
      mockUrls[entry.endpoint] = {
        body: entry.response as JsonValue,
        status: entry.status,
      };
    }
  }

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
    `https://api.github.com/repos/${ORG}/${REPO}/issues?per_page=1&page=1&direction=desc&state=all`
  ] = {
    body: [{ number: MAX_RECORDS }],
    status: 200,
  };

  mockFetch(mockUrls);
}

await loadEnv();

const connectionString = env.DATABASE_URL_PG;
if (!connectionString) {
  console.error("DATABASE_URL_PG is not set");
  process.exit(1);
}

const sql = createSqlClient(connectionString);
try {
  const [{ count }] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM pull_request
  `;
  if (count > 0) {
    console.log(`Dev database already seeded (${count} pull requests).`);
  } else {
    const start = performance.now();
    await installFixtureFetch();

    const repository = new PostgresRepository(ORG, REPO, sql);
    const ghApi = new GhApi(ORG, REPO, "devuser", "devtoken");
    const backfiller = new Backfiller(ghApi, repository, {
      silent: true,
      computedUserMetricsRepository: new PostgresComputedUserMetricsRepository(
        sql,
      ),
      userRelationshipService: new UserRelationshipService(
        new PostgresUserRelationshipRepository(sql),
      ),
      trendsRepository: new TrendsRepository(sql),
      repositoryContributorsRepository: new RepositoryContributorsRepository(
        sql,
      ),
    });

    await backfiller.backfillFromLatest(MAX_RECORDS);
    console.log(
      `Seeded ${ORG}/${REPO} fixture in ${((performance.now() - start) / 1000).toFixed(1)}s.`,
    );
  }

  // Link the seeded repo to the Demo workspace so dev/demo users can see it.
  await sql`
    INSERT INTO workspace_repository (workspace_id, repository_id, added_by)
    SELECT w.workspace_id, r.repository_id, NULL
    FROM workspace w
    JOIN repository r ON r.org = ${ORG} AND r.name = ${REPO}
    WHERE w.slug = 'demo'
    ON CONFLICT (workspace_id, repository_id) DO NOTHING
  `;
} finally {
  await sql.end({ timeout: 1 });
}
