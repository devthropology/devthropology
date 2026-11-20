import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { createGithubArchive } from "../../features/githubArchive/githubArchiveService.ts";
import { readGithubArchiveConfig } from "../../features/githubArchive/githubArchiveConfig.ts";
import { deepStrictEqual as assertEquals } from "node:assert/strict";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  onTestFinished,
} from "vitest";
import { loadTestData } from "../loadTestData.ts";
import { Backfiller } from "../../backfill/backfiller.ts";
import { GhApi } from "../../api/ghApi.ts";
import { PostgresRepository } from "../../repository/postgresRepository.ts";
import { z } from "zod";
import {
  AuthorStatsSchema,
  FullIssue,
  FullPullRequest,
  ReviewerStatsSchema,
} from "../../models/dbTypes.ts";
import {
  postgresTailscaleAuthorStats,
  tailscaleIssues,
  tailscaleReviewStats,
} from "./expectedTailscale.ts";
import { expectedIssues } from "./expectedMadeUp.ts";
import { createSqlClient } from "../../repository/sqlClient.ts";
import {
  getCleanTestDatabase,
  getTestDatabase,
} from "../../testUtils/testDatabase.ts";
import { PostgresComputedUserMetricsRepository } from "../../repository/postgresComputedUserMetricsRepository.ts";
import {
  USER_METRIC_KEYS,
  USER_METRIC_PERIODS,
} from "../../../shared/models/userMetrics.ts";
import { TrendsRepository } from "../../features/trends/trendsRepository.ts";

describe("Backfiller with PostgreSQL", () => {
  describe("tailscale", () => {
    let testrepo: PostgresRepository;

    beforeAll(async () => {
      const { repository } = await getTestDatabase();
      testrepo = repository as PostgresRepository;
    });

    it("pull requests (50)", async function () {
      const allIssues: (FullIssue | FullPullRequest)[] = [];
      for (let i = 500; i >= 450; i--) {
        const issue = await testrepo.getFullIssue(i);
        allIssues.push(issue);
      }

      normalizeAllIssues(allIssues);
      normalizeAllIssues(tailscaleIssues);

      assertEquals(allIssues.length, 51);
      assertEquals(allIssues, tailscaleIssues);
    });

    it("closed issue count", async function () {
      const issues = await testrepo.getClosedIssues();
      assertEquals(issues.length, 483);

      const allIssues: (FullIssue | FullPullRequest)[] = [];
      for (let i = 500; i >= 450; i--) {
        const issue = await testrepo.getFullIssue(i);
        allIssues.push(issue);
      }

      normalizeAllIssues(allIssues);
      normalizeAllIssues(tailscaleIssues);

      assertEquals(allIssues, tailscaleIssues);
    });

    it("reviewer stats", async function () {
      const reviewStats = await testrepo.getReviewerStats(
        new Date("2020-01-01"),
        new Date("2022-01-01"),
        1,
      );

      const expectedReviewerStats = z
        .array(ReviewerStatsSchema)
        .parse(tailscaleReviewStats);

      function sortByReviewer<T extends { reviewer: string }>(arr: T[]): T[] {
        return arr.slice().sort((a, b) => a.reviewer.localeCompare(b.reviewer));
      }

      const sortedActual = sortByReviewer(reviewStats);
      const sortedExpected = sortByReviewer(expectedReviewerStats);
      assertEquals(sortedActual, sortedExpected);
    });

    it("author stats", async function () {
      const repositoryId = 1; // Use test repository ID
      const authorStats = await testrepo.getAuthorStats(
        new Date("2020-01-01"),
        new Date("2022-01-01"),
        repositoryId,
      );
      const expectedAuthorStats = z
        .array(AuthorStatsSchema)
        .parse(postgresTailscaleAuthorStats);

      function sortByAuthor<T extends { author: string }>(arr: T[]): T[] {
        return arr.slice().sort((a, b) => a.author.localeCompare(b.author));
      }

      const sortedActual = sortByAuthor(authorStats);
      const sortedExpected = sortByAuthor(expectedAuthorStats);
      assertEquals(sortedActual, sortedExpected);
    });

    it("repository details", async function () {
      const details = await testrepo.getRepositoryDetails();
      // Should include at least the tailscale repository
      assertEquals(details.length >= 1, true);
      const tailscaleRepo = details.find(
        (repo) => repo.org === "tailscale" && repo.name === "tailscale",
      );
      assertEquals(tailscaleRepo?.repository_id, 1);
      assertEquals(tailscaleRepo?.org, "tailscale");
      assertEquals(tailscaleRepo?.name, "tailscale");
    });
  });

  describe("Individual test cases", () => {
    let connectionString: string;

    beforeAll(async () => {
      connectionString = await getCleanTestDatabase();
    });

    afterEach(async () => {
      // Clean up the database between tests to ensure isolation
      const sql = createSqlClient(connectionString);

      try {
        // Truncate all tables to ensure clean state between tests
        await sql.unsafe(`
          TRUNCATE TABLE 
            pull_request_commit, 
            pull_request_file, 
            pull_request_comment, 
            issue_comment, 
            pull_request_review, 
            pull_request_round_of_review, 
            pull_request, 
            issue, 
            user_activity, 
            "user", 
            repository 
          RESTART IDENTITY CASCADE;
        `);
      } catch (error) {
        console.error("Failed to truncate tables:", error);
      } finally {
        await sql.end({ timeout: 1 });
      }
    });

    it("Process made up PR", async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "github-archive-integration-"),
      );
      onTestFinished(() => rm(directory, { recursive: true, force: true }));
      await loadTestData("backend/test/data/madeup.jsonl", "org", "repo", 3);
      const ghApi = new GhApi("org", "repo", "testuser", "testtoken");
      const sql = createSqlClient(connectionString);
      const repo = new PostgresRepository("org", "repo", sql);
      const computedMetricsRepo = new PostgresComputedUserMetricsRepository(
        sql,
      );
      const trendsRepository = new TrendsRepository(sql);

      const backfiller = new Backfiller(ghApi, repo, {
        archive: createGithubArchive(
          { owner: "org", name: "repo" },
          readGithubArchiveConfig({
            GH_ARCHIVE_LOCAL: "true",
            GH_ARCHIVE_DIR: directory,
          }),
        ),
        silent: true,
        computedUserMetricsRepository: computedMetricsRepo,
        trendsRepository,
      });

      await backfiller.backfillFromLatest(3);

      const testrepo = new PostgresRepository("org", "repo", sql);
      const closedIssues = await testrepo.getClosedIssues();
      // Not sure why I needed to do this, maybe some library version change for ordering
      closedIssues.sort((a: number, b: number) => a - b);
      assertEquals(closedIssues, [1, 3]);

      const issues: (FullIssue | FullPullRequest)[] = [];
      for (let i = 1; i <= 3; i++) {
        issues.push(await testrepo.getFullIssue(i));
      }

      normalizeAllIssues(issues);
      normalizeAllIssues(expectedIssues);

      assertEquals(issues, expectedIssues);

      const files = (await readdir(directory, { recursive: true })).filter(
        (f) => f.endsWith(".json.zst"),
      );
      expect(files).toHaveLength(2); // Closed PR #1 and issue #3; open PR #2 is excluded.
      const capture = JSON.parse(
        zstdDecompressSync(
          await readFile(
            join(
              directory,
              files.find((f) => f.includes("/1/"))!,
            ),
          ),
        ).toString(),
      );
      expect(capture).toMatchObject({
        version: 1,
        number: 1,
        type: "pull_request",
        repository: { owner: "org", name: "repo" },
      });
      expect(
        capture.responses.find((r: { endpoint: string }) =>
          r.endpoint.includes("/files?"),
        ).response[0].patch,
      ).toBe("patch1");
      expect(
        capture.responses.find((r: { endpoint: string }) =>
          r.endpoint.includes("/issues/1/comments?"),
        ).response[0].node_id,
      ).toBe("PRR_kwDOBqLpXs38bMxk");
      await backfiller.backfillFromLatest(3);
      expect(
        (await readdir(directory, { recursive: true }))
          .filter((f) => f.endsWith(".json.zst"))
          .sort(),
      ).toEqual(files.sort());

      await Promise.all([
        repo.close(),
        testrepo.close(),
        computedMetricsRepo.close(),
        sql.end({ timeout: 1 }),
      ]);
    });

    it("ingests a GitHub issue comment containing a NUL into PostgreSQL", async () => {
      const originalFetch = globalThis.fetch;
      const sql = createSqlClient(connectionString);
      try {
        await loadTestData(
          "backend/test/data/comments-no-author.jsonl",
          "org",
          "repo",
          1,
          {
            "https://api.github.com/repos/org/repo/issues/1/comments?per_page=100&page=1":
              {
                status: 200,
                body: [
                  {
                    id: 123456789,
                    user: { id: 1, login: "userA" },
                    body: "\u0000hello \u0000world\u0000",
                    author_association: "MEMBER",
                    created_at: "2023-09-15T12:30:00Z",
                    updated_at: "2023-09-15T12:30:00Z",
                  },
                ],
              },
          },
        );
        const repo = new PostgresRepository("org", "repo", sql);
        const backfiller = new Backfiller(
          new GhApi("org", "repo", "testuser", "testtoken"),
          repo,
          {
            // Keep insert errors visible: Backfiller logs rather than rethrows them.
            silent: false,
            computedUserMetricsRepository:
              new PostgresComputedUserMetricsRepository(sql),
            trendsRepository: new TrendsRepository(sql),
          },
        );

        await backfiller.backfillFromLatest(1);

        const comments = await sql.unsafe<{ body: string }[]>(
          "SELECT body FROM issue_comment WHERE gh_issue_comment_id = $1",
          [123456789],
        );
        assertEquals(comments.length, 1);
        assertEquals(comments[0].body, "hello world");
        assertEquals(comments[0].body.includes("\u0000"), false);
      } finally {
        globalThis.fetch = originalFetch;
        await sql.end({ timeout: 1 });
      }
    });

    // Need to expand the json for this and reverify for correctness - PR says 3 comments, but there are 2 + a review
    it("PR was commits with no author", async () => {
      await loadTestData(
        "backend/test/data/comments-no-author.jsonl",
        "org",
        "repo",
        1,
      );
      const ghApi = new GhApi("org", "repo", "testuser", "testtoken");
      const sql = createSqlClient(connectionString);
      const repo = new PostgresRepository("org", "repo", sql);
      const computedMetricsRepo = new PostgresComputedUserMetricsRepository(
        sql,
      );
      const trendsRepository = new TrendsRepository(sql);

      const backfiller = new Backfiller(ghApi, repo, {
        silent: true,
        computedUserMetricsRepository: computedMetricsRepo,
        trendsRepository,
      });

      await backfiller.backfillFromLatest(1);

      const testrepo = new PostgresRepository("org", "repo", sql);
      const closedIssues = await testrepo.getClosedIssues();
      assertEquals(closedIssues, [1]);

      const expectedIssue = {
        _id: 1,
        id: 1,
        title: "Sample Issue Title 1",
        state: "closed",
        body: "This is the description of the issue.",
        created_at: "2023-09-15T10:30:00.000Z",
        updated_at: "2023-09-16T15:45:00.000Z",
        closed_at: "2023-09-17T15:45:00.000Z",
        user: { name: "userA" },
        _pr_id: 1,
        merged_at: "2023-09-17T15:45:00.000Z",
        target_branch: "master",
        source_branch: "main",
        rounds_of_review: 0,
        reviewComments: [],
        issueComments: [
          {
            body: "This looks good!",
            created_at: "2023-09-15T12:30:00.000Z",
            updated_at: "2023-09-15T12:30:00.000Z",
            author_association: "MEMBER",
            user: { name: "userA" },
          },
          {
            body: "I have some concerns about this change.",
            created_at: "2023-09-15T11:30:00.000Z",
            updated_at: "2023-09-15T11:30:00.000Z",
            author_association: "CONTRIBUTOR",
            user: { name: "userB" },
          },
        ],
        commits: [
          {
            message: "Fixes a bug in the code.",
            committed_at: "2023-09-15T10:00:00.000Z",
            user: { name: "userA" },
          },
          {
            message: "Adds a new feature to the code.",
            committed_at: "2023-09-15T11:00:00.000Z",
            user: { name: "userA" },
          },
          {
            committed_at: "2023-09-15T10:58:00.000Z",
            message: "Commit with empty author for testing purposes.",
            user: {
              name: "userA",
            },
          },
          {
            committed_at: "2023-09-15T10:59:00.000Z",
            message: "Commit with null author for testing purposes.",
            user: {
              name: "userA",
            },
          },
        ],
        files: [
          {
            filename: "version/version.go",
            additions: 75,
            deletions: 50,
            changes: 125,
          },
          {
            filename: "version/xversion.go",
            additions: 25,
            deletions: 0,
            changes: 25,
          },
        ],
      };

      const issue = await testrepo.getFullIssue(1);

      normalizeAllIssues([issue]);
      normalizeAllIssues([expectedIssue]);

      assertEquals(issue, expectedIssue);

      await Promise.all([
        repo.close(),
        testrepo.close(),
        computedMetricsRepo.close(),
        sql.end({ timeout: 1 }),
      ]);
    });

    it("includes review metrics for closed unmerged non-main PRs", async () => {
      await loadTestData(
        "backend/test/data/unmerged-reviewed-pr.jsonl",
        "org",
        "repo",
        1,
      );
      const ghApi = new GhApi("org", "repo", "testuser", "testtoken");
      const sql = createSqlClient(connectionString);
      const repo = new PostgresRepository("org", "repo", sql);
      const computedMetricsRepo = new PostgresComputedUserMetricsRepository(
        sql,
      );
      const trendsRepository = new TrendsRepository(sql);

      const backfiller = new Backfiller(ghApi, repo, {
        silent: true,
        computedUserMetricsRepository: computedMetricsRepo,
        trendsRepository,
      });

      await backfiller.backfillFromLatest(1);

      const repositoryDetails = await repo.getRepositoryDetails();
      const repositoryId = repositoryDetails[0].repository_id;
      const reviewerMetrics = await computedMetricsRepo.getMetricsForUser(
        repositoryId,
        "reviewer1",
      );

      assertEquals(
        reviewerMetrics.metrics[USER_METRIC_KEYS.PRS_REVIEWED][
          USER_METRIC_PERIODS.ALL_TIME
        ].value,
        1,
      );
      assertEquals(
        reviewerMetrics.metrics[USER_METRIC_KEYS.PR_COMMENTS_ADDED][
          USER_METRIC_PERIODS.ALL_TIME
        ].value,
        3,
      );

      await Promise.all([
        repo.close(),
        computedMetricsRepo.close(),
        sql.end({ timeout: 1 }),
      ]);
    });

    it("Issue has been moved", async () => {
      await loadTestData(
        "backend/test/data/issue-moved.jsonl",
        "org",
        "repo",
        1,
      );
      const ghApi = new GhApi("org", "repo", "testuser", "testtoken");
      const sql = createSqlClient(connectionString);
      const repo = new PostgresRepository("org", "repo", sql);
      const computedMetricsRepo = new PostgresComputedUserMetricsRepository(
        sql,
      );
      const trendsRepository = new TrendsRepository(sql);

      const backfiller = new Backfiller(ghApi, repo, {
        silent: true,
        computedUserMetricsRepository: computedMetricsRepo,
        trendsRepository,
      });

      await backfiller.backfillFromLatest(1);

      const testrepo = new PostgresRepository("org", "repo", sql);
      const closedIssues = await testrepo.getClosedIssues();
      assertEquals(closedIssues, [1]);

      const expectedIssue = {
        _id: 1,
        id: 1,
        title: "Issue has been moved",
        state: "closed",
        body: "Issue has been moved",
        created_at: "1970-01-01T00:00:00.000Z",
        updated_at: "1970-01-01T00:00:00.000Z",
        closed_at: "1970-01-01T00:00:00.000Z",
        user: { name: "unknown." },
      };
      const issue = await testrepo.getFullIssue(1);
      assertEquals(issue, expectedIssue);

      await Promise.all([
        repo.close(),
        testrepo.close(),
        computedMetricsRepo.close(),
        sql.end({ timeout: 1 }),
      ]);
    });

    it("Issue has been deleted", async () => {
      await loadTestData(
        "backend/test/data/issue-deleted.jsonl",
        "org",
        "repo",
        1,
      );
      const ghApi = new GhApi("org", "repo", "testuser", "testtoken");
      const sql = createSqlClient(connectionString);
      const repo = new PostgresRepository("org", "repo", sql);
      const computedMetricsRepo = new PostgresComputedUserMetricsRepository(
        sql,
      );
      const trendsRepository = new TrendsRepository(sql);

      const backfiller = new Backfiller(ghApi, repo, {
        silent: true,
        computedUserMetricsRepository: computedMetricsRepo,
        trendsRepository,
      });

      await backfiller.backfillFromLatest(1);

      const testrepo = new PostgresRepository("org", "repo", sql);
      const closedIssues = await testrepo.getClosedIssues();
      assertEquals(closedIssues, [1]);

      const expectedIssue = {
        _id: 1,
        id: 1,
        title: "Issue has been deleted",
        state: "closed",
        body: "Issue has been deleted",
        created_at: "1970-01-01T00:00:00.000Z",
        updated_at: "1970-01-01T00:00:00.000Z",
        closed_at: "1970-01-01T00:00:00.000Z",
        user: { name: "unknown." },
      };
      const issue = await testrepo.getFullIssue(1);
      assertEquals(issue, expectedIssue);

      await Promise.all([
        repo.close(),
        testrepo.close(),
        computedMetricsRepo.close(),
        sql.end({ timeout: 1 }),
      ]);
    });

    it("1970 commit date", async () => {
      await loadTestData(
        "backend/test/data/epochCommitDate.jsonl",
        "org",
        "repo",
        1,
      );
      const ghApi = new GhApi("org", "repo", "testuser", "testtoken");
      const sql = createSqlClient(connectionString);
      const repo = new PostgresRepository("org", "repo", sql);
      const computedMetricsRepo = new PostgresComputedUserMetricsRepository(
        sql,
      );
      const trendsRepository = new TrendsRepository(sql);

      const backfiller = new Backfiller(ghApi, repo, {
        silent: true,
        computedUserMetricsRepository: computedMetricsRepo,
        trendsRepository,
      });

      await backfiller.backfillFromLatest(1);

      const testrepo = new PostgresRepository("org", "repo", sql);
      const closedIssues = await testrepo.getClosedIssues();
      assertEquals(closedIssues, [1]);

      const expectedIssue = {
        _id: 1,
        id: 1,
        title: "Test issue",
        state: "closed",
        body: "",
        created_at: "2024-09-01T18:31:38.000Z",
        updated_at: "2024-09-01T18:32:18.000Z",
        closed_at: "2024-09-01T18:31:45.000Z",
        user: { name: "example-user" },
        _pr_id: 1,
        merged_at: "2024-09-01T18:31:45.000Z",
        target_branch: "master",
        source_branch: "test-branch",
        rounds_of_review: 0,
        reviewComments: [],
        issueComments: [],
        commits: [
          {
            message: "Commit message for changes",
            committed_at: "2024-09-01T18:31:38.000Z",
            user: { name: "example-user" },
          },
        ],
        files: [],
      };
      const issue = await testrepo.getFullIssue(1);
      assertEquals(issue, expectedIssue);

      // The old test used to have "commit" for first/last seen
      const expectedActivity = [
        {
          user_id: 1,
          first_seen_issue_id: 1,
          first_seen_timestamp: "2024-09-01T18:31:38.000Z",
          first_seen_activity_type: "issue",
          last_seen_issue_id: 1,
          last_seen_timestamp: "2024-09-01T18:31:38.000Z",
          last_seen_activity_type: "issue",
        },
      ];
      const activity = await testrepo.getUserActivity(1);
      assertEquals(activity, expectedActivity);

      await Promise.all([
        repo.close(),
        testrepo.close(),
        computedMetricsRepo.close(),
        sql.end({ timeout: 1 }),
      ]);
    });
  });
});

const normalizeAllIssues = (items: (FullIssue | FullPullRequest)[]) => {
  for (const item of items) {
    // Sort review comments on pull requests
    if ("reviewComments" in item && item.reviewComments) {
      item.reviewComments.sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
    }

    // Sort issue comments
    if ("issueComments" in item && item.issueComments) {
      item.issueComments.sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
    }

    // Sort commits on pull requests
    if ("commits" in item && item.commits) {
      // Commits are sorted by the committer date, which is more reliable than the author date.
      item.commits.sort(
        (a, b) =>
          new Date(a.committed_at).getTime() -
          new Date(b.committed_at).getTime(),
      );
    }
  }
};
