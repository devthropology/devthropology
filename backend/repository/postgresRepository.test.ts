import { PostgresRepository } from "./postgresRepository.ts";
import {
  deepStrictEqual as assertEquals,
  notDeepStrictEqual as assertNotEquals,
} from "node:assert/strict";
import { afterAll, beforeAll, describe, it } from "vitest";
import { HydratedIssue } from "../models/gh/issue.ts";
import { State } from "../models/gh/state.ts";
import { IssueType } from "../models/gh/issueType.ts";
import { UNKNOWN_USER } from "../models/gh/user.ts";
import { AuthorAssociation } from "../models/gh/authorAssociation.ts";
import { ReviewState } from "../models/gh/review.ts";
import { ReviewerStats } from "../models/dbTypes.ts";
import { createSqlClient, SqlClient } from "./sqlClient.ts";
import type { GithubUserProfileSnapshot } from "../../shared/models/githubUser.ts";
import { normalizeGithubTimestamp } from "../util/githubUserProfile.ts";
import { getCleanTestDatabase } from "../testUtils/testDatabase.ts";

describe("PostgresRepository", () => {
  let sql: SqlClient;

  beforeAll(async () => {
    const connectionString = await getCleanTestDatabase();
    sql = createSqlClient(connectionString);
  });

  afterAll(async () => {
    await sql?.end({ timeout: 1 });
  });

  it("refreshes types for existing and cached users without erasing them", async () => {
    const repo = new PostgresRepository("typed-org", "typed-repo", sql);
    const users = [
      { id: 99001, login: "typed-automation" },
      { id: 99002, login: "typed-person[bot]" },
    ];
    await repo.getOrCreateUsers(users);
    await repo.getOrCreateUsers([
      { ...users[0], type: "Bot" },
      { ...users[1], type: "User" },
    ]);
    await repo.getOrCreateUsers(users);
    const freshRepo = new PostgresRepository("typed-org", "typed-repo", sql);
    await freshRepo.getOrCreateUsers([
      { ...users[0], type: "Bot" },
      { ...users[1], type: null },
    ]);
    const rows = await sql.unsafe(`SELECT gh_login, gh_type,
      COALESCE(gh_type = 'Bot', gh_login LIKE '%[bot]%') AS is_bot
      FROM "user" WHERE gh_user_id IN (99001, 99002) ORDER BY gh_user_id`);
    assertEquals(
      rows.map((row) => [row.gh_type, row.is_bot]),
      [
        ["Bot", true],
        ["User", false],
      ],
    );
  });

  it("should create new repository and return repository_id", async () => {
    const repo = new PostgresRepository("testorg", "testrepo", sql);

    const repoId = await repo.getRepositoryId("testorg", "testrepo");

    assertEquals(repoId, 1);

    await repo.close();
  });

  it("should return same repository_id for existing repository", async () => {
    const repo = new PostgresRepository("testorg2", "testrepo2", sql);

    // First call should create the repository
    const repoId1 = await repo.getRepositoryId("testorg2", "testrepo2");

    // Second call should return the same ID
    const repoId2 = await repo.getRepositoryId("testorg2", "testrepo2");

    assertEquals(repoId1, repoId2);
    assertNotEquals(repoId1, 0);

    await repo.close();
  });

  it("should return different IDs for different repositories", async () => {
    const repo = new PostgresRepository("org1", "repo1", sql);

    const repoId1 = await repo.getRepositoryId("org1", "repo1");
    const repoId2 = await repo.getRepositoryId("org2", "repo2");

    assertNotEquals(repoId1, repoId2);
    assertNotEquals(repoId1, 0);
    assertNotEquals(repoId2, 0);

    await repo.close();
  });

  it("should get repository details", async () => {
    const repo = new PostgresRepository("testorg", "testrepo", sql);

    // First create a repository
    await repo.getRepositoryId("detailsorg", "detailsrepo");

    const details = await repo.getRepositoryDetails();

    assertEquals(details.length > 0, true);
    assertEquals(typeof details[0].repository_id, "number");
    assertEquals(typeof details[0].org, "string");
    assertEquals(typeof details[0].name, "string");

    await repo.close();
  });

  it("should create and map users", async () => {
    const repo = new PostgresRepository("testorg", "testrepo", sql);

    const testUsers = [
      { id: 12345, login: "testuser1" },
      { id: 67890, login: "testuser2" },
    ];

    const userMap = await repo.getOrCreateUsers(testUsers);

    assertEquals(userMap.size, 2);
    assertEquals(typeof userMap.get(12345), "number");
    assertEquals(typeof userMap.get(67890), "number");

    await repo.close();
  });

  it("should not archive unchanged GitHub profiles", async () => {
    const repo = new PostgresRepository(
      "profileorgsame",
      "profilereposame",
      sql,
    );

    const userMap = await repo.getOrCreateUsers([
      {
        id: 70001,
        login: "profileusersame",
      },
    ]);
    const userId = userMap.get(70001)!;
    const profile: GithubUserProfileSnapshot = {
      avatar_url: "https://avatars.githubusercontent.com/u/70001?v=4",
      name: "Profile User",
      company: "Example Co",
      location: "NYC",
      email: "profile@example.com",
      github_created_at: "2013-02-01T01:25:13Z",
    };

    const firstUpsert = await repo.upsertUserProfile(userId, profile);
    const secondUpsert = await repo.upsertUserProfile(userId, { ...profile });

    assertEquals(firstUpsert.changed, true);
    assertEquals(secondUpsert.changed, false);

    const current = await repo.getUserProfileByLogin("profileusersame");
    assertEquals(current?.name, profile.name);
    assertEquals(current?.email, profile.email);

    const historyRows = await sql.unsafe(
      `SELECT COUNT(*) AS count FROM github_user_profile_history WHERE user_id = $1`,
      [userId],
    );
    assertEquals(Number(historyRows[0].count), 0);

    await repo.close();
  });

  it("should archive the previous GitHub profile when tracked fields change", async () => {
    const repo = new PostgresRepository(
      "profileorgchanged",
      "profilerepochanged",
      sql,
    );

    const userMap = await repo.getOrCreateUsers([
      {
        id: 70002,
        login: "profileuserchanged",
      },
    ]);
    const userId = userMap.get(70002)!;
    const originalProfile: GithubUserProfileSnapshot = {
      avatar_url: "https://avatars.githubusercontent.com/u/70002?v=4",
      name: "Dan Clark",
      company: "Example Co",
      location: "NYC",
      email: null,
      github_created_at: "2013-02-01T01:25:13Z",
    };
    const updatedProfile: GithubUserProfileSnapshot = {
      avatar_url: "https://avatars.githubusercontent.com/u/70002?v=5",
      name: "Daniel Clark",
      company: "OpenCode",
      location: "Brooklyn",
      email: "dan@example.com",
      github_created_at: "2013-02-01T01:25:13Z",
    };

    await repo.upsertUserProfile(userId, originalProfile);
    const updated = await repo.upsertUserProfile(userId, updatedProfile);

    assertEquals(updated.changed, true);

    const current = await repo.getUserProfileByLogin("profileuserchanged");
    assertEquals(current?.avatar_url, updatedProfile.avatar_url);
    assertEquals(current?.name, updatedProfile.name);
    assertEquals(current?.company, updatedProfile.company);
    assertEquals(current?.location, updatedProfile.location);
    assertEquals(current?.email, updatedProfile.email);
    assertEquals(
      current?.github_created_at,
      normalizeGithubTimestamp(updatedProfile.github_created_at),
    );

    const historyRows = await sql.unsafe(
      `SELECT avatar_url, name, company, location, email, github_created_at
       FROM github_user_profile_history
       WHERE user_id = $1`,
      [userId],
    );

    assertEquals(historyRows.length, 1);
    assertEquals(String(historyRows[0].avatar_url), originalProfile.avatar_url);
    assertEquals(String(historyRows[0].name), originalProfile.name);
    assertEquals(String(historyRows[0].company), originalProfile.company);
    assertEquals(String(historyRows[0].location), originalProfile.location);
    assertEquals(historyRows[0].email, originalProfile.email);
    assertEquals(
      new Date(historyRows[0].github_created_at as string | Date).toISOString(),
      normalizeGithubTimestamp(originalProfile.github_created_at),
    );

    await repo.close();
  });

  it("should select missing, stale, and legacy avatar-only profiles for refresh", async () => {
    const repo = new PostgresRepository(
      "profileorgrefresh",
      "profilereporefresh",
      sql,
    );

    const userMap = await repo.getOrCreateUsers([
      { id: 70003, login: "missingprofile" },
      { id: 70004, login: "staleprofile" },
      { id: 70005, login: "freshprofile" },
      { id: 70006, login: "legacyprofile" },
    ]);
    const staleUserId = userMap.get(70004)!;
    const freshUserId = userMap.get(70005)!;
    const legacyUserId = userMap.get(70006)!;

    await repo.upsertUserProfile(staleUserId, {
      avatar_url: "https://avatars.githubusercontent.com/u/70004?v=4",
      name: "Stale Profile",
      company: "Example Co",
      location: "NYC",
      email: null,
      github_created_at: "2013-02-01T01:25:13Z",
    });
    await repo.upsertUserProfile(freshUserId, {
      avatar_url: "https://avatars.githubusercontent.com/u/70005?v=4",
      name: "Fresh Profile",
      company: "Example Co",
      location: "NYC",
      email: null,
      github_created_at: "2013-02-01T01:25:13Z",
    });

    await sql.unsafe(
      `UPDATE github_user_profile
       SET synced_at = now() - interval '8 days'
       WHERE user_id = $1`,
      [staleUserId],
    );

    await sql.unsafe(
      `INSERT INTO github_user_profile (user_id, avatar_url)
       VALUES ($1, $2)`,
      [legacyUserId, "https://avatars.githubusercontent.com/u/70006?v=4"],
    );

    const profileCutoffDate = new Date();
    profileCutoffDate.setDate(profileCutoffDate.getDate() - 7);

    const usersToRefresh =
      await repo.getUsersNeedingProfileSync(profileCutoffDate);
    const logins = usersToRefresh.map((user) => user.gh_login);

    assertEquals(logins.includes("missingprofile"), true);
    assertEquals(logins.includes("staleprofile"), true);
    assertEquals(logins.includes("legacyprofile"), true);
    assertEquals(logins.includes("freshprofile"), false);

    const unsyncedUsers = await repo.getUsersMissingProfileSync();
    const unsyncedLogins = unsyncedUsers.map((user) => user.gh_login);

    assertEquals(unsyncedLogins.includes("missingprofile"), true);
    assertEquals(unsyncedLogins.includes("staleprofile"), false);
    assertEquals(unsyncedLogins.includes("legacyprofile"), false);
    assertEquals(unsyncedLogins.includes("freshprofile"), false);

    await repo.close();
  });

  it("should get lowest issue ID", async () => {
    const repo = new PostgresRepository("testorg", "testrepo", sql);

    // This should return a number, even if there are no issues
    const lowestId = await repo.getLowestIssueId();

    assertEquals(typeof lowestId, "number");

    await repo.close();
  });

  it("should return closed issues correctly", async () => {
    const repo = new PostgresRepository(
      "closedissuesorg",
      "closedissuesrepo",
      sql,
    );

    const repoId = await repo.getRepositoryId(
      "closedissuesorg",
      "closedissuesrepo",
    );

    // First create a test user
    const testUsers = [{ id: 99999, login: "testuser" }];
    const userMap = await repo.getOrCreateUsers(testUsers);
    const userId = userMap.get(99999)!;

    // TODO: Consider using insertIssue() instead of direct SQL once it's ported
    // Insert test issues - some closed, some open
    await sql.unsafe(
      `
      INSERT INTO issue (repository_id, user_id, gh_issue_id, title, state, body, created_at, updated_at, closed_at, issue_type_id)
      VALUES 
        ($1, $2, 100, 'Open Issue', 'open', 'body', NOW(), NOW(), NULL, 1),
        ($1, $2, 101, 'Closed Issue 1', 'closed', 'body', NOW(), NOW(), NOW(), 1),
        ($1, $2, 102, 'Closed Issue 2', 'closed', 'body', NOW(), NOW(), NOW(), 1),
        ($1, $2, 103, 'Another Open Issue', 'open', 'body', NOW(), NOW(), NULL, 1)
    `,
      [repoId, userId],
    );

    const closedIssues = await repo.getClosedIssues();

    // Should return only the closed issues (101, 102)
    assertEquals(closedIssues.length, 2);
    assertEquals(closedIssues.includes(101), true);
    assertEquals(closedIssues.includes(102), true);
    assertEquals(closedIssues.includes(100), false);
    assertEquals(closedIssues.includes(103), false);

    await repo.close();
  });

  it("should return open non-pull-request issues correctly", async () => {
    const repo = new PostgresRepository("opennonprorg", "opennonprrepo", sql);

    const repoId = await repo.getRepositoryId("opennonprorg", "opennonprrepo");

    const testUsers = [{ id: 77777, login: "nonpruser" }];
    const userMap = await repo.getOrCreateUsers(testUsers);
    const userId = userMap.get(77777)!;

    await sql.unsafe(
      `
      INSERT INTO issue (repository_id, user_id, gh_issue_id, title, state, body, created_at, updated_at, closed_at, issue_type_id)
      VALUES 
        ($1, $2, 110, 'Open Issue', 'open', 'body', NOW(), NOW(), NULL, 1),
        ($1, $2, 111, 'Open PR', 'open', 'body', NOW(), NOW(), NULL, 2),
        ($1, $2, 112, 'Closed Issue', 'closed', 'body', NOW(), NOW(), NOW(), 1),
        ($1, $2, 113, 'Open Discussion', 'open', 'body', NOW(), NOW(), NULL, 3)
    `,
      [repoId, userId],
    );

    const openNonPrIssues = await repo.getOpenNonPullRequestIssues();

    assertEquals(openNonPrIssues.length, 2);
    assertEquals(openNonPrIssues.includes(110), true);
    assertEquals(openNonPrIssues.includes(113), true);
    assertEquals(openNonPrIssues.includes(111), false);
    assertEquals(openNonPrIssues.includes(112), false);

    await repo.close();
  });

  it("should return open pull requests to skip correctly", async () => {
    const repo = new PostgresRepository("openprorg", "openprrepo", sql);

    const repoId = await repo.getRepositoryId("openprorg", "openprrepo");

    // Create test user
    const testUsers = [{ id: 88888, login: "pruser" }];
    const userMap = await repo.getOrCreateUsers(testUsers);
    const userId = userMap.get(88888)!;

    const cutoffDate = new Date("2023-06-01T00:00:00Z");

    // TODO: Consider using insertIssue() instead of direct SQL once it's ported
    // Insert test issues with different states and dates
    await sql.unsafe(
      `
      INSERT INTO issue (repository_id, user_id, gh_issue_id, title, state, body, created_at, updated_at, closed_at, issue_type_id)
      VALUES 
        ($1, $2, 200, 'Old Open PR', 'open', 'body', '2023-05-01', '2023-05-01', NULL, 2),
        ($1, $2, 201, 'New Open PR', 'open', 'body', '2023-07-01', '2023-07-01', NULL, 2),
        ($1, $2, 202, 'Closed PR', 'closed', 'body', '2023-07-01', '2023-07-01', '2023-07-02', 2)
    `,
      [repoId, userId],
    );

    const openPRsToSkip = await repo.getOpenPullRequestsToSkip(
      "pruser",
      cutoffDate,
    );

    // Should only return the new open PR (201) created after cutoff
    assertEquals(openPRsToSkip.length, 1);
    assertEquals(openPRsToSkip.includes(201), true);
    assertEquals(openPRsToSkip.includes(200), false); // too old
    assertEquals(openPRsToSkip.includes(202), false); // closed

    await repo.close();
  });

  it("should return processed pull requests correctly", async () => {
    const repo = new PostgresRepository("processedorg", "processedrepo", sql);

    const repoId = await repo.getRepositoryId("processedorg", "processedrepo");

    // Create test user
    const testUsers = [{ id: 77777, login: "processeduser" }];
    const userMap = await repo.getOrCreateUsers(testUsers);
    const userId = userMap.get(77777)!;

    // TODO: Consider using insertIssue() instead of direct SQL once it's ported
    // Insert test issues
    await sql.unsafe(
      `
      INSERT INTO issue (repository_id, user_id, gh_issue_id, title, state, body, created_at, updated_at, closed_at, issue_type_id)
      VALUES 
        ($1, $2, 300, 'Open PR', 'open', 'body', NOW(), NOW(), NULL, 2),
        ($1, $2, 301, 'Closed PR 1', 'closed', 'body', NOW(), NOW(), NOW(), 2),
        ($1, $2, 302, 'Closed PR 2', 'closed', 'body', NOW(), NOW(), NOW(), 2)
    `,
      [repoId, userId],
    );

    const processedPRs =
      await repo.getAllProcessedPullRequests("processeduser");

    // Should return only closed PRs (301, 302)
    assertEquals(processedPRs.length, 2);
    assertEquals(processedPRs.includes(301), true);
    assertEquals(processedPRs.includes(302), true);
    assertEquals(processedPRs.includes(300), false); // still open

    await repo.close();
  });

  it("should insert a simple issue correctly", async () => {
    const repo = new PostgresRepository(
      "insertissueorg",
      "insertissuerepo",
      sql,
    );

    const repoId = await repo.getRepositoryId(
      "insertissueorg",
      "insertissuerepo",
    );

    // Create a simple issue (not a pull request)
    const simpleIssue: HydratedIssue = {
      number: 999,
      title: "Test Issue",
      body: "This is a test issue",
      state: State.OPEN,
      created_at: new Date("2023-01-01T00:00:00Z"),
      updated_at: new Date("2023-01-01T00:00:00Z"),
      closed_at: null,
      user: UNKNOWN_USER,
      type: IssueType.ISSUE,
      hydrated_pull_request: undefined,
    };

    // Should not throw an error
    await repo.insertIssue(simpleIssue, 0);

    // Verify the issue was inserted
    const issues = await sql.unsafe(
      "SELECT * FROM issue WHERE repository_id = $1 AND gh_issue_id = $2",
      [repoId, 999],
    );
    assertEquals(issues.length, 1);
    assertEquals(issues[0].title, "Test Issue");
    assertEquals(issues[0].state, "open");
    assertEquals(Number(issues[0].issue_type_id), IssueType.ISSUE);

    await repo.close();
  });

  it("should insert a closed issue correctly", async () => {
    const repo = new PostgresRepository(
      "closedissueorg",
      "closedissuerepo",
      sql,
    );

    const repoId = await repo.getRepositoryId(
      "closedissueorg",
      "closedissuerepo",
    );

    const closedIssue: HydratedIssue = {
      number: 888,
      title: "Closed Test Issue",
      body: "This is a closed test issue",
      state: State.CLOSED,
      created_at: new Date("2023-01-01T00:00:00Z"),
      updated_at: new Date("2023-01-02T00:00:00Z"),
      closed_at: new Date("2023-01-02T00:00:00Z"),
      user: { id: 12345, login: "testuser" },
      type: IssueType.ISSUE,
      hydrated_pull_request: undefined,
    };

    // Should not throw an error
    await repo.insertIssue(closedIssue, 0);

    // Verify the issue was inserted
    const issues = await sql.unsafe(
      "SELECT * FROM issue WHERE repository_id = $1 AND gh_issue_id = $2",
      [repoId, 888],
    );
    assertEquals(issues.length, 1);
    assertEquals(issues[0].title, "Closed Test Issue");
    assertEquals(issues[0].state, "closed");
    assertEquals(issues[0].closed_at, new Date("2023-01-02T00:00:00.000Z"));

    await repo.close();
  });

  it("should insert a simple pull request correctly", async () => {
    const repo = new PostgresRepository("simpleprorg", "simpleprrepo", sql);

    const repoId = await repo.getRepositoryId("simpleprorg", "simpleprrepo");

    // Create a simple merged pull request with minimal data
    const simplePR: HydratedIssue = {
      number: 777,
      title: "Test PR",
      body: "This is a test pull request",
      state: State.CLOSED,
      created_at: new Date("2023-01-01T00:00:00Z"),
      updated_at: new Date("2023-01-02T00:00:00Z"),
      closed_at: new Date("2023-01-02T00:00:00Z"),
      user: { id: 54321, login: "pruser" },
      type: IssueType.PULL_REQUEST,
      hydrated_pull_request: {
        number: 777,
        user: { id: 54321, login: "pruser" },
        title: "Test PR",
        state: State.CLOSED,
        body: "This is a test pull request",
        created_at: new Date("2023-01-01T00:00:00Z"),
        updated_at: new Date("2023-01-02T00:00:00Z"),
        closed_at: new Date("2023-01-02T00:00:00Z"),
        merged_at: new Date("2023-01-02T00:00:00Z"),
        merge_commit_sha: "abc123",
        sourceBranch: "feature-branch",
        targetBranch: "main",
        comments: 2,
        review_comments: 1,
        commits: 3,
        additions: 10,
        deletions: 5,
        changed_files: 2,
        reviews: [],
        commentList: [],
        issueCommentList: [],
        commitList: [],
        files: [],
      },
    };

    // Should not throw an error
    await repo.insertIssue(simplePR, 1);

    // Verify the issue was inserted
    const issues = await sql.unsafe(
      "SELECT * FROM issue WHERE repository_id = $1 AND gh_issue_id = $2",
      [repoId, 777],
    );
    assertEquals(issues.length, 1);
    assertEquals(issues[0].title, "Test PR");
    assertEquals(Number(issues[0].issue_type_id), IssueType.PULL_REQUEST);

    // Verify the pull request was inserted
    const pullRequests = await sql.unsafe(
      "SELECT * FROM pull_request WHERE issue_id = $1",
      [issues[0].issue_id],
    );
    assertEquals(pullRequests.length, 1);
    assertEquals(pullRequests[0].target_branch, "main");
    assertEquals(pullRequests[0].source_branch, "feature-branch");
    assertEquals(pullRequests[0].additions, 10);
    assertEquals(pullRequests[0].deletions, 5);

    // Verify rounds of reviews was inserted
    const rounds = await sql.unsafe(
      "SELECT * FROM pull_request_round_of_review WHERE pull_request_id = $1",
      [pullRequests[0].pull_request_id],
    );
    assertEquals(rounds.length, 1);
    assertEquals(rounds[0].rounds, 1);

    const enhancedStats = await sql.unsafe(
      "SELECT * FROM pull_request_enhanced_stats WHERE pull_request_id = $1",
      [pullRequests[0].pull_request_id],
    );
    assertEquals(enhancedStats.length, 1);
    assertEquals(enhancedStats[0].rounds_of_review, 1);
    assertEquals(enhancedStats[0].bot_rounds_of_review, 0);
    assertEquals(enhancedStats[0].first_review_at, null);
    assertEquals(enhancedStats[0].first_approval_at, null);
    assertEquals(enhancedStats[0].first_effective_approval_at, null);
    assertEquals(enhancedStats[0].merged_after_post_approval_commit, false);

    await repo.close();
  });

  it("should not insert PR details for open pull requests", async () => {
    const repo = new PostgresRepository("openprorg", "openprrepo", sql);

    const repoId = await repo.getRepositoryId("openprorg", "openprrepo");

    const openPR: HydratedIssue = {
      number: 666,
      title: "Open PR",
      body: "This is an open pull request",
      state: State.OPEN,
      created_at: new Date("2023-01-01T00:00:00Z"),
      updated_at: new Date("2023-01-01T00:00:00Z"),
      closed_at: null,
      user: { id: 11111, login: "openpruser" },
      type: IssueType.PULL_REQUEST,
      hydrated_pull_request: {
        number: 666,
        user: { id: 11111, login: "openpruser" },
        title: "Open PR",
        state: State.OPEN,
        body: "This is an open pull request",
        created_at: new Date("2023-01-01T00:00:00Z"),
        updated_at: new Date("2023-01-01T00:00:00Z"),
        closed_at: null,
        merged_at: null,
        merge_commit_sha: null,
        sourceBranch: "open-feature",
        targetBranch: "main",
        comments: 0,
        review_comments: 0,
        commits: 1,
        additions: 5,
        deletions: 0,
        changed_files: 1,
        reviews: [],
        commentList: [],
        issueCommentList: [],
        commitList: [],
        files: [],
      },
    };

    // Should not throw an error
    await repo.insertIssue(openPR, 0);

    // Verify the issue was inserted
    const issues = await sql.unsafe(
      "SELECT * FROM issue WHERE repository_id = $1 AND gh_issue_id = $2",
      [repoId, 666],
    );
    assertEquals(issues.length, 1);
    assertEquals(issues[0].state, "open");
    assertEquals(Number(issues[0].issue_type_id), IssueType.PULL_REQUEST);

    // Verify NO pull request details were inserted (since it's open)
    const pullRequests = await sql.unsafe(
      "SELECT * FROM pull_request WHERE issue_id = $1",
      [issues[0].issue_id],
    );
    assertEquals(pullRequests.length, 0);

    await repo.close();
  });

  it("should get issue correctly", async () => {
    const repo = new PostgresRepository("getissueorg", "getissuerepo", sql);

    const testIssue: HydratedIssue = {
      number: 123,
      title: "Test Issue for getIssue",
      body: "This is a test issue body",
      state: State.OPEN,
      created_at: new Date("2023-01-01T00:00:00Z"),
      updated_at: new Date("2023-01-01T00:00:00Z"),
      closed_at: null,
      user: { id: 55555, login: "issueuser" },
      type: IssueType.ISSUE,
      hydrated_pull_request: undefined,
    };

    await repo.insertIssue(testIssue, 0);

    // Now test getIssue
    const issue = await repo.getIssue(123);

    assertEquals(issue.id, 123);
    assertEquals(issue.title, "Test Issue for getIssue");
    assertEquals(issue.body, "This is a test issue body");
    assertEquals(issue.state, "open");
    assertEquals(issue.name, "issueuser");
    assertEquals(typeof issue._id, "number");

    await repo.close();
  });

  it("should get full issue (non-PR) correctly", async () => {
    const repo = new PostgresRepository(
      "getfullissueorg",
      "getfullissuerepo",
      sql,
    );

    // Create test user
    const testUsers = [{ id: 44444, login: "fullissueuser" }];
    await repo.getOrCreateUsers(testUsers);

    // Insert a test issue using insertIssue
    const testIssue: HydratedIssue = {
      number: 456,
      title: "Test Full Issue",
      body: "This is a test full issue body",
      state: State.CLOSED,
      created_at: new Date("2023-01-01T00:00:00Z"),
      updated_at: new Date("2023-01-02T00:00:00Z"),
      closed_at: new Date("2023-01-02T00:00:00Z"),
      user: { id: 44444, login: "fullissueuser" },
      type: IssueType.ISSUE,
      hydrated_pull_request: undefined,
    };

    await repo.insertIssue(testIssue, 0);

    // Now test getFullIssue
    const fullIssue = await repo.getFullIssue(456);

    assertEquals(fullIssue.id, 456);
    assertEquals(fullIssue.title, "Test Full Issue");
    assertEquals(fullIssue.body, "This is a test full issue body");
    assertEquals(fullIssue.state, "closed");
    assertEquals(fullIssue.user.name, "fullissueuser");
    assertEquals(typeof fullIssue._id, "number");

    await repo.close();
  });

  it("should get full pull request correctly", async () => {
    const repo = new PostgresRepository("getfullprorg", "getfullprrepo", sql);

    // Create test users
    const testUsers = [
      { id: 33333, login: "prauthor" },
      { id: 22222, login: "reviewer" },
      { id: 11111, login: "commenter" },
    ];
    await repo.getOrCreateUsers(testUsers);

    // Insert a test pull request with all related data
    const testPR: HydratedIssue = {
      number: 789,
      title: "Test Full PR",
      body: "This is a test full pull request body",
      state: State.CLOSED,
      created_at: new Date("2023-01-01T00:00:00Z"),
      updated_at: new Date("2023-01-02T00:00:00Z"),
      closed_at: new Date("2023-01-02T00:00:00Z"),
      user: { id: 33333, login: "prauthor" },
      type: IssueType.PULL_REQUEST,
      hydrated_pull_request: {
        number: 789,
        user: { id: 33333, login: "prauthor" },
        title: "Test Full PR",
        state: State.CLOSED,
        body: "This is a test full pull request body",
        created_at: new Date("2023-01-01T00:00:00Z"),
        updated_at: new Date("2023-01-02T00:00:00Z"),
        closed_at: new Date("2023-01-02T00:00:00Z"),
        merged_at: new Date("2023-01-02T00:00:00Z"),
        merge_commit_sha: "def456",
        sourceBranch: "test-branch",
        targetBranch: "main",
        comments: 1,
        review_comments: 1,
        commits: 2,
        additions: 20,
        deletions: 10,
        changed_files: 3,
        reviews: [
          {
            id: 1001,
            user: { id: 22222, login: "reviewer" },
            body: "LGTM",
            author_association: AuthorAssociation.COLLABORATOR,
            state: ReviewState.APPROVED,
            submitted_at: new Date("2023-01-01T12:00:00Z"),
          },
        ],
        commentList: [
          {
            id: 2001,
            user: { id: 11111, login: "commenter" },
            path: "test.ts",
            body: "Nice code!",
            author_association: AuthorAssociation.CONTRIBUTOR,
            created_at: new Date("2023-01-01T11:00:00Z"),
            updated_at: new Date("2023-01-01T11:00:00Z"),
          },
        ],
        issueCommentList: [
          {
            id: 3001,
            user: { id: 11111, login: "commenter" },
            body: "Great work!",
            author_association: AuthorAssociation.CONTRIBUTOR,
            created_at: new Date("2023-01-01T10:00:00Z"),
            updated_at: new Date("2023-01-01T10:00:00Z"),
          },
        ],
        commitList: [
          {
            commitSha: "abc123",
            commitTitle: "Fix bug",
            user: { id: 33333, login: "prauthor" },
            commitTime: new Date("2023-01-01T09:00:00Z"),
          },
        ],
        files: [
          {
            filename: "test.ts",
            additions: 15,
            deletions: 5,
            changes: 20,
            status: "modified",
          },
        ],
      },
    };

    await repo.insertIssue(testPR, 2);

    // Now test getFullIssue
    const fullPR = await repo.getFullIssue(789);

    // Verify basic issue fields
    assertEquals(fullPR.id, 789);
    assertEquals(fullPR.title, "Test Full PR");
    assertEquals(fullPR.body, "This is a test full pull request body");
    assertEquals(fullPR.state, "closed");
    assertEquals(fullPR.user.name, "prauthor");

    // Check if it's a FullPullRequest by checking for PR-specific properties
    if (
      "reviewComments" in fullPR &&
      "issueComments" in fullPR &&
      "commits" in fullPR &&
      "files" in fullPR
    ) {
      // It's a FullPullRequest, so we can safely assert on PR fields
      assertEquals(fullPR.target_branch, "main");
      assertEquals(fullPR.source_branch, "test-branch");
      assertEquals(fullPR.rounds_of_review, 2);

      // Check the arrays we populated
      assertEquals(fullPR.reviewComments.length, 1);
      assertEquals(fullPR.reviewComments[0].body, "Nice code!");
      assertEquals(fullPR.reviewComments[0].user.name, "commenter");

      assertEquals(fullPR.issueComments.length, 1);
      assertEquals(fullPR.issueComments[0].body, "Great work!");
      assertEquals(fullPR.issueComments[0].user.name, "commenter");

      assertEquals(fullPR.commits.length, 1);
      assertEquals(fullPR.commits[0].message, "Fix bug");
      assertEquals(fullPR.commits[0].user.name, "prauthor");

      assertEquals(fullPR.files.length, 1);
      assertEquals(fullPR.files[0].filename, "test.ts");
      assertEquals(fullPR.files[0].additions, 15);
      assertEquals(fullPR.files[0].deletions, 5);

      // TODO: Test reviews field - currently missing from FullPullRequestSchema
      // The schema defines 'reviewComments' but does not expose the inserted reviews.
      // We need to add: reviews: z.array(DbReviewWithUserSchema) to FullPullRequestSchema
      // Until then, we can't properly assert on the reviews we inserted

      // TODO: Test PR stats fields like additions, deletions, etc.
      // These are missing from DbPullRequestSchema and need to be added for full compatibility
    } else {
      // It should be a FullPullRequest for our test data
      throw new Error("Expected FullPullRequest but got FullIssue");
    }

    await repo.close();
  });

  it("should get review stats correctly", async () => {
    const repo = new PostgresRepository(
      "reviewstatsorg",
      "reviewstatsrepo",
      sql,
    );

    // Insert a PR with review data using insertIssue (which handles user creation)
    const testPR: HydratedIssue = {
      number: 1001,
      title: "PR for Review Stats",
      body: "Testing review stats",
      state: State.CLOSED,
      created_at: new Date("2023-01-01T00:00:00Z"),
      updated_at: new Date("2023-01-02T00:00:00Z"),
      closed_at: new Date("2023-01-02T00:00:00Z"),
      user: { id: 11001, login: "author1" },
      type: IssueType.PULL_REQUEST,
      hydrated_pull_request: {
        number: 1001,
        user: { id: 11001, login: "author1" },
        title: "PR for Review Stats",
        state: State.CLOSED,
        body: "Testing review stats",
        created_at: new Date("2023-01-01T00:00:00Z"),
        updated_at: new Date("2023-01-02T00:00:00Z"),
        closed_at: new Date("2023-01-02T00:00:00Z"),
        merged_at: new Date("2023-01-02T00:00:00Z"),
        merge_commit_sha: "abc123",
        sourceBranch: "feature",
        targetBranch: "main",
        comments: 1,
        review_comments: 1,
        commits: 1,
        additions: 10,
        deletions: 5,
        changed_files: 2,
        reviews: [
          {
            id: 2001,
            user: { id: 11002, login: "reviewer1" },
            body: "LGTM",
            author_association: AuthorAssociation.COLLABORATOR,
            state: ReviewState.APPROVED,
            submitted_at: new Date("2023-01-01T12:00:00Z"),
          },
        ],
        commentList: [
          {
            id: 2002,
            user: { id: 11002, login: "reviewer1" },
            path: "test.ts",
            body: "Good code!",
            author_association: AuthorAssociation.COLLABORATOR,
            created_at: new Date("2023-01-01T13:00:00Z"),
            updated_at: new Date("2023-01-01T13:00:00Z"),
          },
        ],
        issueCommentList: [],
        commitList: [],
        files: [],
      },
    };

    const repositoryId = await repo.getRepositoryId(
      "reviewstatsorg",
      "reviewstatsrepo",
    );
    await repo.insertIssue(testPR, repositoryId);

    // Test getReviewStats - should find the reviewer we just inserted
    const startDate = new Date("2023-01-01T00:00:00Z");
    const endDate = new Date("2023-01-03T00:00:00Z");
    const reviewStats = await repo.getReviewerStats(
      startDate,
      endDate,
      repositoryId,
    );

    // Should find our reviewer
    assertEquals(reviewStats.length >= 1, true);

    // Find the reviewer we inserted
    const reviewer1Stats = reviewStats.find(
      (stat: ReviewerStats) => stat.reviewer === "reviewer1",
    );
    assertEquals(reviewer1Stats !== undefined, true);

    if (reviewer1Stats) {
      // Should have at least 1 review count and 1 approval count
      assertEquals(reviewer1Stats.review_count >= 1, true);
      assertEquals(reviewer1Stats.approval_count >= 1, true);
      assertEquals(
        typeof reviewer1Stats.median_time_as_first_reviewer,
        "number",
      );
    }

    const filteredStats = await repo.getReviewerStats(
      startDate,
      endDate,
      repositoryId,
      ["reviewer1"],
    );
    assertEquals(filteredStats.length, 1);
    assertEquals(filteredStats[0].reviewer, "reviewer1");

    const missingStats = await repo.getReviewerStats(
      startDate,
      endDate,
      repositoryId,
      ["notareviewer"],
    );
    assertEquals(missingStats.length, 0);

    await repo.close();
  });

  it("should get user activity correctly", async () => {
    const repo = new PostgresRepository(
      "useractivityorg",
      "useractivityrepo",
      sql,
    );

    // Insert a PR which will create user activity when we call updateUserActivity
    const testPR: HydratedIssue = {
      number: 1002,
      title: "PR for User Activity",
      body: "Testing user activity",
      state: State.CLOSED,
      created_at: new Date("2023-01-01T00:00:00Z"),
      updated_at: new Date("2023-01-02T00:00:00Z"),
      closed_at: new Date("2023-01-02T00:00:00Z"),
      user: { id: 12001, login: "activityuser" },
      type: IssueType.PULL_REQUEST,
      hydrated_pull_request: {
        number: 1002,
        user: { id: 12001, login: "activityuser" },
        title: "PR for User Activity",
        state: State.CLOSED,
        body: "Testing user activity",
        created_at: new Date("2023-01-01T00:00:00Z"),
        updated_at: new Date("2023-01-02T00:00:00Z"),
        closed_at: new Date("2023-01-02T00:00:00Z"),
        merged_at: new Date("2023-01-02T00:00:00Z"),
        merge_commit_sha: "abc123",
        sourceBranch: "feature",
        targetBranch: "main",
        comments: 0,
        review_comments: 0,
        commits: 0,
        additions: 5,
        deletions: 2,
        changed_files: 1,
        reviews: [],
        commentList: [],
        issueCommentList: [],
        commitList: [],
        files: [],
      },
    };

    const repositoryId = await repo.getRepositoryId(
      "useractivityorg",
      "useractivityrepo",
    );
    await repo.insertIssue(testPR, repositoryId);

    // Since there's no user activity data yet (updateUserActivity hasn't been called),
    // this should return an empty array
    const userActivity = await repo.getUserActivity(repositoryId);

    // Should return valid array structure
    assertEquals(Array.isArray(userActivity), true);

    await repo.close();
  });

  it("should update user activity correctly", async () => {
    const repo = new PostgresRepository(
      "updateactivityorg",
      "updateactivityrepo",
      sql,
    );

    // Insert a PR which should create user activity records
    const testPR: HydratedIssue = {
      number: 1003,
      title: "PR for Update Activity",
      body: "Testing update user activity",
      state: State.CLOSED,
      created_at: new Date("2023-01-01T00:00:00Z"),
      updated_at: new Date("2023-01-02T00:00:00Z"),
      closed_at: new Date("2023-01-02T00:00:00Z"),
      user: { id: 13001, login: "updateuser" },
      type: IssueType.PULL_REQUEST,
      hydrated_pull_request: {
        number: 1003,
        user: { id: 13001, login: "updateuser" },
        title: "PR for Update Activity",
        state: State.CLOSED,
        body: "Testing update user activity",
        created_at: new Date("2023-01-01T00:00:00Z"),
        updated_at: new Date("2023-01-02T00:00:00Z"),
        closed_at: new Date("2023-01-02T00:00:00Z"),
        merged_at: new Date("2023-01-02T00:00:00Z"),
        merge_commit_sha: "def456",
        sourceBranch: "feature",
        targetBranch: "main",
        comments: 0,
        review_comments: 0,
        commits: 0,
        additions: 8,
        deletions: 3,
        changed_files: 2,
        reviews: [],
        commentList: [],
        issueCommentList: [],
        commitList: [],
        files: [],
      },
    };

    const repositoryId = await repo.getRepositoryId(
      "updateactivityorg",
      "updateactivityrepo",
    );
    await repo.insertIssue(testPR, repositoryId);

    // Before updating, user activity should be empty
    const beforeActivity = await repo.getUserActivity(repositoryId);
    assertEquals(beforeActivity.length, 0);

    // Update user activity (this will analyze all data and populate user_activity table)
    await repo.updateUserActivity();

    // After updating, we should have user activity data
    const afterActivity = await repo.getUserActivity(repositoryId);
    assertEquals(afterActivity.length >= 1, true);

    // Verify the structure of returned data
    if (afterActivity.length > 0) {
      const firstActivity = afterActivity[0];
      assertEquals(typeof firstActivity.user_id, "number");
      assertEquals(typeof firstActivity.first_seen_issue_id, "number");
      assertEquals(typeof firstActivity.first_seen_timestamp, "string");
      assertEquals(typeof firstActivity.first_seen_activity_type, "string");
    }

    await repo.close();
  });

  it("should exclude commit-only users from user activity", async () => {
    const repo = new PostgresRepository(
      "commitactivityorg",
      "commitactivityrepo",
      sql,
    );

    const testPR: HydratedIssue = {
      number: 1004,
      title: "PR with external commit",
      body: "Testing commit-only exclusion",
      state: State.CLOSED,
      created_at: new Date("2023-02-01T00:00:00Z"),
      updated_at: new Date("2023-02-02T00:00:00Z"),
      closed_at: new Date("2023-02-02T00:00:00Z"),
      user: { id: 14001, login: "authoronly" },
      type: IssueType.PULL_REQUEST,
      hydrated_pull_request: {
        number: 1004,
        user: { id: 14001, login: "authoronly" },
        title: "PR with external commit",
        state: State.CLOSED,
        body: "Testing commit-only exclusion",
        created_at: new Date("2023-02-01T00:00:00Z"),
        updated_at: new Date("2023-02-02T00:00:00Z"),
        closed_at: new Date("2023-02-02T00:00:00Z"),
        merged_at: new Date("2023-02-02T00:00:00Z"),
        merge_commit_sha: "ghi789",
        sourceBranch: "feature",
        targetBranch: "main",
        comments: 0,
        review_comments: 0,
        commits: 1,
        additions: 12,
        deletions: 4,
        changed_files: 1,
        reviews: [],
        commentList: [],
        issueCommentList: [],
        commitList: [
          {
            commitSha: "commit-only-user-sha",
            commitTitle: "Commit from non-contributor",
            user: { id: 14002, login: "commitonlyuser" },
            commitTime: new Date("2023-02-01T12:00:00Z"),
          },
        ],
        files: [
          {
            filename: "test.ts",
            additions: 12,
            deletions: 4,
            changes: 16,
            status: "modified",
          },
        ],
      },
    };

    const repositoryId = await repo.getRepositoryId(
      "commitactivityorg",
      "commitactivityrepo",
    );
    await repo.insertIssue(testPR, 1);

    await repo.updateUserActivity();

    const activityOverview = await repo.getUserActivityOverview(repositoryId);
    const logins = activityOverview.map((row) => row.gh_login);

    assertEquals(logins.includes("authoronly"), true);
    assertEquals(logins.includes("commitonlyuser"), false);

    await repo.close();
  });

  it("should persist filesystem nodes correctly", async () => {
    const repo = new PostgresRepository("filesystemorg", "filesystemrepo", sql);

    const repositoryId = await repo.getRepositoryId(
      "filesystemorg",
      "filesystemrepo",
    );

    // Create test filesystem nodes using realistic FileSystemNode structure
    const testNodes = [
      {
        repository_id: repositoryId,
        path: "src",
        parent_path: null,
        level: 1,
        node_data: {
          name: "src",
          path: "src",
          level: 1,
          type: "folder" as const,
          parent_path: null,
          total_files: 5,
          total_adds: 100,
          total_subs: 20,
          total_changes: 120,
          total_prs: 3,
          total_contributors: 2,
          first_seen: "2023-01-01T00:00:00Z",
          last_updated: "2023-01-05T00:00:00Z",
          children_count: 2,
          contributors: [
            {
              gh_login: "user1",
              total_adds: 60,
              total_subs: 10,
              total_changes: 70,
              pct_of_changes: 58.3,
              num_prs: 2,
              pct_of_prs: 66.7,
              first_seen_in_directory: "2023-01-01T00:00:00Z",
              last_seen_in_directory: "2023-01-03T00:00:00Z",
              last_seen_anywhere: "2023-01-05T00:00:00Z",
            },
          ],
        },
      },
      {
        repository_id: repositoryId,
        path: "src/main.ts",
        parent_path: "src",
        level: 2,
        node_data: {
          name: "main.ts",
          path: "src/main.ts",
          level: 2,
          type: "file" as const,
          parent_path: "src",
          total_files: 1,
          total_adds: 50,
          total_subs: 10,
          total_changes: 60,
          total_prs: 2,
          total_contributors: 1,
          first_seen: "2023-01-01T00:00:00Z",
          last_updated: "2023-01-03T00:00:00Z",
          contributors: [
            {
              gh_login: "user1",
              total_adds: 50,
              total_subs: 10,
              total_changes: 60,
              pct_of_changes: 100,
              num_prs: 2,
              pct_of_prs: 100,
              first_seen_in_directory: "2023-01-01T00:00:00Z",
              last_seen_in_directory: "2023-01-03T00:00:00Z",
              last_seen_anywhere: "2023-01-03T00:00:00Z",
            },
          ],
        },
      },
    ];

    // Persist the nodes
    await repo.persistFileSystem(repositoryId, testNodes);

    // Verify they were inserted
    const persistedNodes = await repo.getFileSystemNodes(repositoryId, "", []);
    assertEquals(persistedNodes.length, 2);

    // Check the first node
    const srcNode = persistedNodes.find((n) => n.path === "src");
    assertEquals(srcNode !== undefined, true);
    if (srcNode) {
      assertEquals(srcNode.repository_id, repositoryId);
      assertEquals(srcNode.path, "src");
      assertEquals(srcNode.parent_path, null);
      assertEquals(srcNode.level, 1);
      assertEquals(srcNode.node_data.name, "src");
      assertEquals(srcNode.node_data.type, "folder");
    }

    await repo.close();
  });

  it("should overwrite filesystem data when persisting again", async () => {
    const repo = new PostgresRepository("overwriteorg", "overwriterepo", sql);

    const repositoryId = await repo.getRepositoryId(
      "overwriteorg",
      "overwriterepo",
    );

    // First batch of nodes
    const firstNodes = [
      {
        repository_id: repositoryId,
        path: "old-file.ts",
        parent_path: null,
        level: 1,
        node_data: {
          name: "old-file.ts",
          path: "old-file.ts",
          level: 1,
          type: "file" as const,
          parent_path: null,
          total_files: 1,
          total_adds: 10,
          total_subs: 5,
          total_changes: 15,
          total_prs: 1,
          total_contributors: 1,
          first_seen: "2023-01-01T00:00:00Z",
          last_updated: "2023-01-01T00:00:00Z",
        },
      },
    ];

    await repo.persistFileSystem(repositoryId, firstNodes);

    // Verify first batch
    let nodes = await repo.getFileSystemNodes(repositoryId, "", []);
    assertEquals(nodes.length, 1);
    assertEquals(nodes[0].path, "old-file.ts");

    // Second batch - should replace the first
    const secondNodes = [
      {
        repository_id: repositoryId,
        path: "new-file.ts",
        parent_path: null,
        level: 1,
        node_data: {
          name: "new-file.ts",
          path: "new-file.ts",
          level: 1,
          type: "file" as const,
          parent_path: null,
          total_files: 1,
          total_adds: 20,
          total_subs: 8,
          total_changes: 28,
          total_prs: 1,
          total_contributors: 1,
          first_seen: "2023-01-02T00:00:00Z",
          last_updated: "2023-01-02T00:00:00Z",
        },
      },
    ];

    await repo.persistFileSystem(repositoryId, secondNodes);

    // Verify second batch replaced first
    nodes = await repo.getFileSystemNodes(repositoryId, "", []);
    assertEquals(nodes.length, 1);
    assertEquals(nodes[0].path, "new-file.ts");

    await repo.close();
  });

  it("should filter filesystem nodes by parent path", async () => {
    const repo = new PostgresRepository("filterorg", "filterrepo", sql);

    const repositoryId = await repo.getRepositoryId("filterorg", "filterrepo");

    const testNodes = [
      {
        repository_id: repositoryId,
        path: "src",
        parent_path: null,
        level: 1,
        node_data: {
          name: "src",
          path: "src",
          level: 1,
          type: "folder" as const,
          parent_path: null,
          total_files: 2,
          total_adds: 100,
          total_subs: 20,
          total_changes: 120,
          total_prs: 3,
          total_contributors: 2,
          first_seen: "2023-01-01T00:00:00Z",
          last_updated: "2023-01-05T00:00:00Z",
          children_count: 2,
        },
      },
      {
        repository_id: repositoryId,
        path: "src/main.ts",
        parent_path: "src",
        level: 2,
        node_data: {
          name: "main.ts",
          path: "src/main.ts",
          level: 2,
          type: "file" as const,
          parent_path: "src",
          total_files: 1,
          total_adds: 50,
          total_subs: 10,
          total_changes: 60,
          total_prs: 2,
          total_contributors: 1,
          first_seen: "2023-01-01T00:00:00Z",
          last_updated: "2023-01-03T00:00:00Z",
        },
      },
      {
        repository_id: repositoryId,
        path: "src/utils.ts",
        parent_path: "src",
        level: 2,
        node_data: {
          name: "utils.ts",
          path: "src/utils.ts",
          level: 2,
          type: "file" as const,
          parent_path: "src",
          total_files: 1,
          total_adds: 30,
          total_subs: 5,
          total_changes: 35,
          total_prs: 1,
          total_contributors: 1,
          first_seen: "2023-01-02T00:00:00Z",
          last_updated: "2023-01-04T00:00:00Z",
        },
      },
      {
        repository_id: repositoryId,
        path: "tests",
        parent_path: null,
        level: 1,
        node_data: {
          name: "tests",
          path: "tests",
          level: 1,
          type: "folder" as const,
          parent_path: null,
          total_files: 1,
          total_adds: 25,
          total_subs: 3,
          total_changes: 28,
          total_prs: 1,
          total_contributors: 1,
          first_seen: "2023-01-03T00:00:00Z",
          last_updated: "2023-01-03T00:00:00Z",
          children_count: 0,
        },
      },
    ];

    await repo.persistFileSystem(repositoryId, testNodes);

    // Get all nodes
    const allNodes = await repo.getFileSystemNodes(repositoryId, "", []);
    assertEquals(allNodes.length, 4);

    // Filter by parent path "src"
    const srcChildren = await repo.getFileSystemNodes(repositoryId, "src", []);
    assertEquals(srcChildren.length, 2);
    assertEquals(
      srcChildren.every((n) => n.parent_path === "src"),
      true,
    );

    // Filter by parent path "tests"
    const testChildren = await repo.getFileSystemNodes(
      repositoryId,
      "tests",
      [],
    );
    assertEquals(testChildren.length, 0); // No children

    await repo.close();
  });

  it("should filter filesystem nodes by levels", async () => {
    const repo = new PostgresRepository("levelsorg", "levelsrepo", sql);

    const repositoryId = await repo.getRepositoryId("levelsorg", "levelsrepo");

    const testNodes = [
      {
        repository_id: repositoryId,
        path: "src",
        parent_path: null,
        level: 1,
        node_data: {
          name: "src",
          path: "src",
          level: 1,
          type: "folder" as const,
          parent_path: null,
          total_files: 3,
          total_adds: 150,
          total_subs: 25,
          total_changes: 175,
          total_prs: 4,
          total_contributors: 2,
          first_seen: "2023-01-01T00:00:00Z",
          last_updated: "2023-01-05T00:00:00Z",
          children_count: 2,
        },
      },
      {
        repository_id: repositoryId,
        path: "src/main.ts",
        parent_path: "src",
        level: 2,
        node_data: {
          name: "main.ts",
          path: "src/main.ts",
          level: 2,
          type: "file" as const,
          parent_path: "src",
          total_files: 1,
          total_adds: 50,
          total_subs: 10,
          total_changes: 60,
          total_prs: 2,
          total_contributors: 1,
          first_seen: "2023-01-01T00:00:00Z",
          last_updated: "2023-01-03T00:00:00Z",
        },
      },
      {
        repository_id: repositoryId,
        path: "src/components",
        parent_path: "src",
        level: 2,
        node_data: {
          name: "components",
          path: "src/components",
          level: 2,
          type: "folder" as const,
          parent_path: "src",
          total_files: 1,
          total_adds: 75,
          total_subs: 10,
          total_changes: 85,
          total_prs: 1,
          total_contributors: 1,
          first_seen: "2023-01-02T00:00:00Z",
          last_updated: "2023-01-04T00:00:00Z",
          children_count: 1,
        },
      },
      {
        repository_id: repositoryId,
        path: "src/components/Button.tsx",
        parent_path: "src/components",
        level: 3,
        node_data: {
          name: "Button.tsx",
          path: "src/components/Button.tsx",
          level: 3,
          type: "file" as const,
          parent_path: "src/components",
          total_files: 1,
          total_adds: 25,
          total_subs: 5,
          total_changes: 30,
          total_prs: 1,
          total_contributors: 1,
          first_seen: "2023-01-02T00:00:00Z",
          last_updated: "2023-01-04T00:00:00Z",
        },
      },
    ];

    await repo.persistFileSystem(repositoryId, testNodes);

    // Get level 1 nodes only
    const level1Nodes = await repo.getFileSystemNodes(repositoryId, "", [1]);
    assertEquals(level1Nodes.length, 1);
    assertEquals(level1Nodes[0].level, 1);

    // Get level 2 nodes only
    const level2Nodes = await repo.getFileSystemNodes(repositoryId, "", [2]);
    assertEquals(level2Nodes.length, 2);
    assertEquals(
      level2Nodes.every((n) => n.level === 2),
      true,
    );

    // Get multiple levels
    const level2And3Nodes = await repo.getFileSystemNodes(
      repositoryId,
      "",
      [2, 3],
    );
    assertEquals(level2And3Nodes.length, 3);

    await repo.close();
  });

  it("should handle empty filesystem persistence", async () => {
    const repo = new PostgresRepository("emptyorg", "emptyrepo", sql);

    const repositoryId = await repo.getRepositoryId("emptyorg", "emptyrepo");

    // Persist empty array
    await repo.persistFileSystem(repositoryId, []);

    // Should return empty array
    const nodes = await repo.getFileSystemNodes(repositoryId, "", []);
    assertEquals(nodes.length, 0);

    await repo.close();
  });

  it("should isolate filesystem data between repositories", async () => {
    const repo1 = new PostgresRepository("isolateorg1", "isolaterepo1", sql);
    const repo2 = new PostgresRepository("isolateorg2", "isolaterepo2", sql);

    const repositoryId1 = await repo1.getRepositoryId(
      "isolateorg1",
      "isolaterepo1",
    );
    const repositoryId2 = await repo2.getRepositoryId(
      "isolateorg2",
      "isolaterepo2",
    );

    // Add data to first repository
    const nodes1 = [
      {
        repository_id: repositoryId1,
        path: "repo1-file.ts",
        parent_path: null,
        level: 1,
        node_data: {
          name: "repo1-file.ts",
          path: "repo1-file.ts",
          level: 1,
          type: "file" as const,
          parent_path: null,
          total_files: 1,
          total_adds: 10,
          total_subs: 2,
          total_changes: 12,
          total_prs: 1,
          total_contributors: 1,
          first_seen: "2023-01-01T00:00:00Z",
          last_updated: "2023-01-01T00:00:00Z",
        },
      },
    ];

    await repo1.persistFileSystem(repositoryId1, nodes1);

    // Add data to second repository
    const nodes2 = [
      {
        repository_id: repositoryId2,
        path: "repo2-file.ts",
        parent_path: null,
        level: 1,
        node_data: {
          name: "repo2-file.ts",
          path: "repo2-file.ts",
          level: 1,
          type: "file" as const,
          parent_path: null,
          total_files: 1,
          total_adds: 15,
          total_subs: 3,
          total_changes: 18,
          total_prs: 1,
          total_contributors: 1,
          first_seen: "2023-01-02T00:00:00Z",
          last_updated: "2023-01-02T00:00:00Z",
        },
      },
    ];

    await repo2.persistFileSystem(repositoryId2, nodes2);

    // Verify isolation
    const repo1Nodes = await repo1.getFileSystemNodes(repositoryId1, "", []);
    const repo2Nodes = await repo2.getFileSystemNodes(repositoryId2, "", []);

    assertEquals(repo1Nodes.length, 1);
    assertEquals(repo1Nodes[0].path, "repo1-file.ts");
    assertEquals(repo2Nodes.length, 1);
    assertEquals(repo2Nodes[0].path, "repo2-file.ts");

    await repo1.close();
    await repo2.close();
  });
});
