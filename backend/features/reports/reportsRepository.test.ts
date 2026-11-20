import { test } from "vitest";
import { readFile } from "node:fs/promises";
import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { createSqlClient } from "../../repository/sqlClient.ts";
import { PostgresRepository } from "../../repository/postgresRepository.ts";
import { ReportsRepository } from "./reportsRepository.ts";
import { ReportsService } from "./reportsService.ts";
import { getEmptyTestDatabase } from "../../testUtils/testDatabase.ts";

test("combined reports: aggregates raw PRs across repos without merging paths, days or PR numbers incorrectly", async () => {
  const sql = createSqlClient(await getEmptyTestDatabase());
  try {
    // The initial migration contains all raw tables used by reports. No local
    // development data is touched; this database lives only for this test.
    const migration = await readFile(
      new URL(
        "../../schema_migrations/postgres/20250704154205_create_initial_postgres_tables.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await sql.unsafe(migration.split("-- migrate:down")[0]);
    await sql.unsafe(`
        INSERT INTO repository (repository_id, org, name) VALUES (1, 'acme', 'frontend'), (2, 'acme', 'backend'), (3, 'private', 'excluded');
        INSERT INTO "user" (user_id, gh_user_id, gh_login) VALUES (1, 101, 'alice'), (2, 102, 'bob'), (3, 103, 'outsider');
        INSERT INTO issue (issue_id, repository_id, user_id, gh_issue_id, title, state, created_at, updated_at, issue_type_id) VALUES
          (1, 1, 1, 1, 'one', 'closed', '2026-01-01', '2026-01-01', 2),
          (2, 1, 1, 2, 'two', 'closed', '2026-01-01', '2026-01-01', 2),
          (3, 2, 1, 1, 'three', 'closed', '2026-01-01', '2026-01-01', 2),
          (4, 3, 3, 1, 'private', 'closed', '2026-01-01', '2026-01-01', 2),
          (5, 2, 1, 2, 'end excluded', 'closed', '2026-01-03', '2026-01-03', 2);
        INSERT INTO pull_request (pull_request_id, issue_id, merged_at, additions, deletions, changed_files,
          source_branch, target_branch, comment_count, review_comment_count, commit_count) VALUES
          (1, 1, '2026-01-01 02:00Z', 10, 0, 1, 'feature', 'main', 0, 0, 1),
          (2, 2, '2026-01-01 04:00Z', 20, 0, 1, 'feature', 'main', 0, 0, 1),
          (3, 3, '2026-01-05 04:00Z', 90, 0, 1, 'feature', 'main', 0, 0, 1),
          (4, 4, '2026-01-01 08:00Z', 1000, 0, 1, 'feature', 'main', 0, 0, 1),
          (5, 5, '2026-01-03 08:00Z', 1000, 0, 1, 'feature', 'main', 0, 0, 1);
        INSERT INTO pull_request_file (pull_request_id, filename, status, additions, deletions, changes)
          SELECT pull_request_id, 'src/index.ts', 'modified', additions, 0, additions FROM pull_request;
        INSERT INTO pull_request_round_of_review (pull_request_id, rounds)
          SELECT pull_request_id, 1 FROM pull_request;
        INSERT INTO pull_request_review (pull_request_id, gh_pull_request_review_id, user_id, body, state, submitted_at, author_association) VALUES
          (1, 1001, 2, 'review', 'APPROVED', '2026-01-01 01:00Z', 'MEMBER'),
          (2, 1002, 2, 'review', 'APPROVED', '2026-01-01 02:00Z', 'MEMBER'),
          (3, 1003, 2, 'review', 'APPROVED', '2026-01-01 03:00Z', 'MEMBER'),
          (4, 1004, 2, 'private', 'APPROVED', '2026-01-01 04:00Z', 'MEMBER'),
          (5, 1005, 2, 'end excluded', 'APPROVED', '2026-01-03 04:00Z', 'MEMBER');
      `);
    const reports = new ReportsRepository(sql);
    const start = new Date("2026-01-01");
    const end = new Date("2026-01-03");
    const authors = await reports.getAuthorStats(start, end, [1, 2, 2]);
    assertEquals(authors.length, 1);
    const alice = authors[0];
    assertEquals(alice.author, "alice");
    assertEquals(alice.active_days, 1);
    assertEquals(alice.merged_prs_count, 3);
    assertEquals(alice.avg_pr_per_active_day, 3);
    assertEquals(alice.avg_time_to_merge, 35.33);
    assertEquals(alice.median_time_to_merge, 4);
    assertEquals(alice.unique_files_touched_count, 2);
    assertEquals(alice.top_touched_package, "acme/frontend:src");
    assertEquals(alice.total_additions, 120);
    const reviewers = await reports.getReviewerStats(start, end, [1, 2]);
    assertEquals(reviewers.length, 1);
    const bob = reviewers[0];
    assertEquals(bob.reviewer, "bob");
    assertEquals(bob.active_days, 1);
    assertEquals(bob.review_count, 3);
    assertEquals(bob.first_review_count, 3);
    assertEquals(bob.unique_authors_interacted_with, 1);
    assertEquals(bob.total_lines_reviewed, 120);
    assertEquals(bob.median_lines_per_reviewed_pr, 20);
    assertEquals(bob.median_time_as_first_reviewer, 2);
    assertEquals(bob.most_interacted_author, "alice");
    assertEquals(
      await reports.getReviewerStats(start, end, [1, 2], ["bob"]),
      reviewers,
    );
    assertEquals(
      await reports.getAuthorStats(start, end, [1, 2], ["alice"]),
      authors,
    );
    assertEquals(await reports.getAuthorStats(start, end, []), []);
    assertEquals(await reports.getReviewerStats(start, end, []), []);
    assertEquals(await reports.getAuthorStats(end, end, [1, 2]), []);
    const legacy = new PostgresRepository("acme", "frontend", sql);
    const singleAuthor = await reports.getAuthorStats(start, end, [1]);
    assertEquals(singleAuthor, await legacy.getAuthorStats(start, end, 1));
    assertEquals(singleAuthor[0].top_touched_package, "src");
    assertEquals(singleAuthor[0].median_time_to_merge, 3);
    assertEquals(
      await reports.getReviewerStats(start, end, [1]),
      await legacy.getReviewerStats(start, end, 1),
    );
    const service = new ReportsService(reports);
    const rated = await service.getAuthors([1, 2], start, end);
    assertEquals(rated.authors[0].merged_prs_count.value, 3);
    assertEquals(rated.thresholds.length > 0, true);
  } finally {
    await sql.end({ timeout: 1 });
  }
});
