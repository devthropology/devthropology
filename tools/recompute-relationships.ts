// node --import tsx tools/recompute-relationships.ts
// Recomputes the computed_user_relationship table for all repositories.

import process, { env } from "node:process";
import { loadEnv } from "../backend/util/loadEnv.ts";
import { createSqlClient } from "../backend/repository/sqlClient.ts";
import { PostgresUserRelationshipRepository } from "../backend/repository/postgresUserRelationshipRepository.ts";
import { RELATIONSHIP_PERIODS } from "../backend/repository/userRelationshipRepository.ts";
import { UserRelationshipService } from "../backend/services/userRelationshipService.ts";

await loadEnv();

const connectionString = env.DATABASE_URL_PG;
if (!connectionString) {
  console.error("DATABASE_URL_PG must be set in .env or environment");
  process.exit(1);
}

const sql = createSqlClient(connectionString);
const repo = new PostgresUserRelationshipRepository(sql);
const service = new UserRelationshipService(repo);

try {
  // Get all repositories
  const repositories = await sql<
    { repository_id: number; org: string; name: string }[]
  >`SELECT repository_id, org, name FROM repository`;

  console.log(`Found ${repositories.length} repositories`);

  const periods = RELATIONSHIP_PERIODS.map((period) => ({
    key: period,
    label: period,
  }));

  for (const r of repositories) {
    console.log(
      `Recomputing relationships for ${r.org}/${r.name} (id=${r.repository_id})...`,
    );

    for (const { key, label } of periods) {
      const start = performance.now();
      await service.recomputeForRepository(r.repository_id, key);
      const elapsed = (performance.now() - start).toFixed(0);

      const [{ count }] = await sql<{ count: string }[]>`
        SELECT COUNT(*)::text AS count
        FROM computed_user_relationship
        WHERE repository_id = ${r.repository_id}
          AND period = ${key}
      `;
      console.log(`  -> [${label}] ${count} edges in ${elapsed}ms`);
    }
  }

  console.log("Done.");
} finally {
  await sql.end({ timeout: 1 });
}
