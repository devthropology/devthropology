import { describe, expect, it } from "vitest";
import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { createSqlClient } from "../../repository/sqlClient.ts";
import {
  getCleanTestDatabase,
  getTestDatabase,
} from "../../testUtils/testDatabase.ts";
import { PostgresTeamRepository } from "../../repository/postgresTeamRepository.ts";
import { TrendsRepository } from "./trendsRepository.ts";
import { TrendsService } from "./trendsService.ts";

async function createTrendsService() {
  const { connectionString } = await getTestDatabase();
  const sql = createSqlClient(connectionString);
  const repository = new TrendsRepository(sql);
  const service = new TrendsService(repository);

  return { service, repository, sql };
}

describe("TrendsService", () => {
  describe("snapshot responses", () => {
    it("returns grouped trends insights snapshot for tailscale repository", async () => {
      const { service, repository, sql } = await createTrendsService();

      try {
        await repository.recomputeMonthlyForRepository(1);
        const insights = await service.getInsights(1);
        expect(insights).toMatchSnapshot();
      } finally {
        await sql.end();
      }
    });

    // TODO: Consider deleting this once the snapshot test is enough to catch
    // regressions and the legacy live-query path is no longer needed for parity.
    it("matches the legacy unfiltered trends response after recomputing monthly rows", async () => {
      const { service, repository, sql } = await createTrendsService();

      try {
        await sql`DELETE FROM computed_trends_monthly WHERE repository_id = ${1}`;
        const legacyInsights = await service.getInsights(1);

        await repository.recomputeMonthlyForRepository(1);
        const computedInsights = await service.getInsights(1);

        assertEquals(computedInsights, legacyInsights);
      } finally {
        await sql.end();
      }
    });

    it("counts only the selected team's authors in each month and repository", async () => {
      const sql = createSqlClient(await getCleanTestDatabase());
      const service = new TrendsService(new TrendsRepository(sql));
      const teamRepository = new PostgresTeamRepository(sql);

      try {
        // Two team authors, an outsider, and a second repository sharing an author.
        // Counts and sizes below are independent of the production aggregation.
        await sql.unsafe(`
          INSERT INTO repository (repository_id, org, name) VALUES
            (91001, 'trends', 'selected'), (91002, 'trends', 'other');
          INSERT INTO "user" (user_id, gh_user_id, gh_login) VALUES
            (91001, 91001, 'alice'), (91002, 91002, 'bob'), (91003, 91003, 'outsider');
          INSERT INTO issue (issue_id, repository_id, user_id, gh_issue_id, title, state, created_at, updated_at, issue_type_id) VALUES
            (91001, 91001, 91001, 1, 'alice one', 'closed', '2026-01-01', '2026-01-01', 2),
            (91002, 91001, 91001, 2, 'alice two', 'closed', '2026-01-01', '2026-01-01', 2),
            (91003, 91001, 91002, 3, 'bob january', 'closed', '2026-01-01', '2026-01-01', 2),
            (91004, 91001, 91003, 4, 'outsider', 'closed', '2026-01-01', '2026-01-01', 2),
            (91005, 91001, 91002, 5, 'bob february', 'closed', '2026-02-01', '2026-02-01', 2),
            (91006, 91002, 91001, 1, 'other repository', 'closed', '2026-01-01', '2026-01-01', 2);
          INSERT INTO pull_request (pull_request_id, issue_id, merged_at, additions, deletions, changed_files,
            source_branch, target_branch, comment_count, review_comment_count, commit_count) VALUES
            (91001, 91001, '2026-01-15 12:00Z', 10, 0, 1, 'feature', 'main', 0, 0, 1),
            (91002, 91002, '2026-01-16 12:00Z', 20, 0, 1, 'feature', 'main', 0, 0, 1),
            (91003, 91003, '2026-01-17 12:00Z', 30, 0, 1, 'feature', 'main', 0, 0, 1),
            (91004, 91004, '2026-01-18 12:00Z', 1000, 0, 1, 'feature', 'main', 0, 0, 1),
            (91005, 91005, '2026-02-15 12:00Z', 50, 0, 1, 'feature', 'main', 0, 0, 1),
            (91006, 91006, '2026-01-19 12:00Z', 2000, 0, 1, 'feature', 'main', 0, 0, 1);
        `);
        const team = await teamRepository.createManualTeam(
          91001,
          "Selected authors",
          [91001, 91002],
        );
        const summarize = (
          insights: Awaited<ReturnType<TrendsService["getInsights"]>>,
        ) =>
          insights.monthly.map((entry) => ({
            year: entry.year,
            month: entry.month,
            prs: entry.mergedPrs,
            authors: entry.authorOutput?.activeAuthors,
            avgSize: entry.prSize?.avgPrSize,
          }));

        assertEquals(summarize(await service.getInsights(91001, team.slug)), [
          { year: 2026, month: 1, prs: 3, authors: 2, avgSize: 20 },
          { year: 2026, month: 2, prs: 1, authors: 1, avgSize: 50 },
        ]);
        assertEquals(summarize(await service.getInsights(91001)), [
          { year: 2026, month: 1, prs: 4, authors: 3, avgSize: 265 },
          { year: 2026, month: 2, prs: 1, authors: 1, avgSize: 50 },
        ]);
      } finally {
        await sql.end();
      }
    });
  });
});
