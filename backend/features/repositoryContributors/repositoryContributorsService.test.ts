import { describe, expect, it } from "vitest";
import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { createSqlClient, type SqlClient } from "../../repository/sqlClient.ts";
import { getTestDatabase } from "../../testUtils/testDatabase.ts";
import { RepositoryContributorsRepository } from "./repositoryContributorsRepository.ts";
import { RepositoryContributorsService } from "./repositoryContributorsService.ts";

async function createRepositoryContributorsService() {
  const { connectionString } = await getTestDatabase();
  const sql = createSqlClient(connectionString);
  const repository = new RepositoryContributorsRepository(sql);
  const service = new RepositoryContributorsService(repository);

  return { service, repository, sql };
}

describe("RepositoryContributorsService", () => {
  it("returns monthly contributor snapshot", async () => {
    const { service, repository, sql } =
      await createRepositoryContributorsService();

    try {
      await repository.recomputeForRepository(1);

      const response = await service.getMonthly(1, Number.MAX_SAFE_INTEGER);

      expect({ months: response.months.slice(0, 3) }).toMatchSnapshot();
    } finally {
      await sql.end();
    }
  });

  it("counts contributors only in months with qualifying activity", async () => {
    const { service, repository, sql } =
      await createRepositoryContributorsService();

    try {
      const repositoryId = await seedContributorFixture(sql);
      await repository.recomputeForRepository(repositoryId);

      const response = await service.getMonthly(
        repositoryId,
        Number.MAX_SAFE_INTEGER,
      );
      const byMonth = new Map(
        response.months.map((entry) => [`${entry.year}-${entry.month}`, entry]),
      );

      assertEquals(byMonth.get("2024-1")?.active.count, 2);
      assertEquals(byMonth.get("2024-2")?.active.count, 1);
      assertEquals(byMonth.has("2024-3"), false);
      assertEquals(byMonth.get("2024-4")?.active.count, 1);

      const sameMonth = byMonth.get("2024-1")!;
      assertEquals(
        sameMonth.active.contributors.some((c) =>
          c.login.startsWith("same-month"),
        ),
        true,
      );
      assertEquals(
        sameMonth.new.contributors.some((c) =>
          c.login.startsWith("same-month"),
        ),
        true,
      );
      assertEquals(
        sameMonth.churned.contributors.some((c) =>
          c.login.startsWith("same-month"),
        ),
        true,
      );
      assertEquals(
        sameMonth.active.count,
        sameMonth.active.contributors.length,
      );
      assertEquals(sameMonth.new.count, sameMonth.new.contributors.length);
      assertEquals(
        sameMonth.churned.count,
        sameMonth.churned.contributors.length,
      );
    } finally {
      await sql.end();
    }
  });
});

async function seedContributorFixture(sql: SqlClient): Promise<number> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [{ repository_id }] = await sql<{ repository_id: number }[]>`
    INSERT INTO repository (org, name)
    VALUES (${`contributors-${suffix}`}, 'monthly')
    RETURNING repository_id
  `;

  const users = await sql<{ user_id: number; gh_login: string }[]>`
    INSERT INTO "user" (gh_user_id, gh_login)
    VALUES
      (${
        10_000_000 + Number.parseInt(suffix.slice(0, 4), 16)
      }, ${`gap-user-${suffix}`}),
      (${
        20_000_000 + Number.parseInt(suffix.slice(4), 16)
      }, ${`same-month-${suffix}`})
    RETURNING user_id, gh_login
  `;

  const userIds = new Map(users.map((user) => [user.gh_login, user.user_id]));
  const gapUser = `gap-user-${suffix}`;
  const sameMonthUser = `same-month-${suffix}`;
  await insertMergedPr(sql, {
    repositoryId: repository_id,
    userId: userIds.get(gapUser)!,
    issueNumber: 1,
    createdAt: "2024-01-10T12:00:00Z",
    mergedAt: "2024-01-11T12:00:00Z",
  });
  await insertMergedPr(sql, {
    repositoryId: repository_id,
    userId: userIds.get(gapUser)!,
    issueNumber: 2,
    createdAt: "2024-02-10T12:00:00Z",
    mergedAt: "2024-02-11T12:00:00Z",
  });
  await insertMergedPr(sql, {
    repositoryId: repository_id,
    userId: userIds.get(gapUser)!,
    issueNumber: 3,
    createdAt: "2024-04-10T12:00:00Z",
    mergedAt: "2024-04-11T12:00:00Z",
  });
  await insertMergedPr(sql, {
    repositoryId: repository_id,
    userId: userIds.get(sameMonthUser)!,
    issueNumber: 4,
    createdAt: "2024-01-20T12:00:00Z",
    mergedAt: "2024-01-21T12:00:00Z",
  });

  return repository_id;
}

async function insertMergedPr(
  sql: SqlClient,
  input: {
    repositoryId: number;
    userId: number;
    issueNumber: number;
    createdAt: string;
    mergedAt: string;
  },
): Promise<void> {
  const [{ issue_id }] = await sql<{ issue_id: number }[]>`
    INSERT INTO issue (
      repository_id,
      user_id,
      gh_issue_id,
      title,
      state,
      body,
      created_at,
      updated_at,
      closed_at,
      issue_type_id
    )
    VALUES (
      ${input.repositoryId},
      ${input.userId},
      ${input.issueNumber},
      ${`PR ${input.issueNumber}`},
      'closed',
      '',
      ${input.createdAt},
      ${input.mergedAt},
      ${input.mergedAt},
      2
    )
    RETURNING issue_id
  `;

  await sql`
    INSERT INTO pull_request (
      issue_id,
      merged_at,
      merge_commit_sha,
      source_branch,
      target_branch,
      comment_count,
      review_comment_count,
      commit_count,
      additions,
      deletions,
      changed_files
    )
    VALUES (
      ${issue_id},
      ${input.mergedAt},
      ${`sha-${input.issueNumber}`},
      'feature',
      'main',
      0,
      0,
      1,
      1,
      0,
      1
    )
  `;
}
