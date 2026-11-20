import { z } from "zod";
import type { ParameterOrJSON } from "postgres";
import { User } from "../models/gh/user.ts";
import { HydratedIssue } from "../models/gh/issue.ts";
import {
  AuthorStats,
  ComputedFileSystemNode,
  ComputedFileSystemNodeSchema,
  ComputedRepositoryOverview,
  ComputedRepositoryOverviewSchema,
  FileSystemActivity,
  FileSystemActivitySchema,
  FullIssue,
  FullPullRequest,
  MergesByDay,
  MergesByDaySchema,
  PrTiming,
  PrTimingSchema,
  RecentIssueReviewSchema,
  RecentPullSchema,
  RenamedFileForBackfill,
  RenamedFileForBackfillSchema,
  RepositoryDetails,
  RepositoryDetailsSchema,
  ReviewerStats,
  UserActivity,
  UserActivityOverview,
  UserActivityOverviewSchema,
  UserActivitySchema,
  UserIssueStats,
  UserIssueStatsSchema,
  UserPullStatsDb,
  UserPullStatsDbSchema,
  UserStatsForUi,
  UserStatsForUiSchema,
} from "../models/dbTypes.ts";
import { DbRow, IRepository } from "./repository.ts";
import {
  MonthlyMetricPoint,
  MonthlyMetricPointSchema,
} from "../../shared/models/userMonthlyMetrics.ts";
import {
  FileSystemPR,
  FileSystemPRSchema,
} from "../../shared/models/fileSystemTree.ts";
import { type GithubUserProfileSnapshot } from "../../shared/models/githubUser.ts";
import { PullRequestEnhancedStats } from "../../shared/models/pullRequestEnhancedStats.ts";
import { State } from "../models/gh/state.ts";
import { IssueType } from "../models/gh/issueType.ts";
import {
  githubUserProfilesDiffer,
  normalizeGithubUserProfileSnapshot,
} from "../util/githubUserProfile.ts";
import {
  createTempUserActivityTable,
  debugUserActivity,
  deleteOldFileSystem,
  deleteOldUserActivity,
  dropTempUserActivityTable,
  getAllProcessedPullRequests,
  getAllUsers,
  getContributorAgeBuckets,
  getFileSystemNodeByPath,
  getFileSystemNodes,
  getFileSystemPRs,
  getMergedPrTiming,
  getMergesByDay,
  getOpenPullRequestsToSkip,
  getRecentPulls,
  getRenamedFilesForBackfill,
  getRepositoryInfo,
  getRepositoryOverview,
  getUserActivity,
  getUserIssueReviews,
  getUserMonthlyLinesModified,
  getUserMonthlyMergedPrs,
  getUserMonthlyPrComments,
  getUserMonthlyPrsReviewed,
  getUserStats,
  indexTempUserActivity,
  insertFileSystemNodes,
  insertNewUserActivity,
  insertPullRequest,
  insertPullRequestEnhancedStats,
  insertRoundOfReviews,
  insertUser,
  populateTempUserActivity,
  updatePreviousFilename,
  updateRepositoryOverview,
  upsertIssue,
} from "./postgresQueries.ts";
import { SqlClient } from "./sqlClient.ts";
import { ReportsRepository } from "../features/reports/reportsRepository.ts";

const MAX_PG_PARAMS = 65535;
const DEFAULT_MAX_ROWS = 1000;
type SqlValue = ParameterOrJSON<never>;
type StoredGithubUserProfile = GithubUserProfileSnapshot & {
  profile_id: number;
};

function chunkByParams<T>(
  rows: T[],
  columnsPerRow: number,
  maxRows: number = DEFAULT_MAX_ROWS,
): T[][] {
  if (rows.length === 0) return [];
  const maxByParams = Math.floor(MAX_PG_PARAMS / columnsPerRow);
  const batchSize = Math.max(1, Math.min(maxRows, maxByParams));
  const batches: T[][] = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    batches.push(rows.slice(i, i + batchSize));
  }
  return batches;
}

function buildBulkInsert(
  table: string,
  columns: string[],
  rows: SqlValue[][],
): { query: string; values: SqlValue[] } {
  const values = rows.flat();
  const placeholders = rows
    .map((_, rowIndex) => {
      const base = rowIndex * columns.length;
      const columnPlaceholders = columns
        .map((_, columnIndex) => `$${base + columnIndex + 1}`)
        .join(",");
      return `(${columnPlaceholders})`;
    })
    .join(",");

  const query = `INSERT INTO ${table} (${columns.join(
    ", ",
  )}) VALUES ${placeholders}`;
  return { query, values };
}

export class PostgresRepository implements IRepository {
  private sql: SqlClient;
  private userIdMap: Map<number, number>;
  private org: string;
  private repo: string;
  private repoId: number | null = null;

  constructor(org: string, repo: string, sql: SqlClient) {
    this.sql = sql;
    this.userIdMap = new Map<number, number>();
    this.org = org;
    this.repo = repo;
  }

  updateRepositoryDetails(org: string, repo: string): void {
    this.org = org;
    this.repo = repo;
  }

  // Interface implementation
  async close(): Promise<void> {
    // No-op: caller owns SqlClient lifecycle
  }

  async getRepositoryDetails(): Promise<RepositoryDetails[]> {
    const query = `
      SELECT
        r.repository_id,
        r.org,
        r.name,
        MAX(ua.inserted_at) as last_sync_at
      FROM repository r
      LEFT JOIN user_activity ua ON r.repository_id = ua.repository_id
      GROUP BY r.repository_id, r.org, r.name
    `;
    const details = await this.sql.unsafe(query);
    // Convert repository_id from string to number for each row
    const convertedDetails = details.map((row) => ({
      ...row,
      repository_id: Number(row.repository_id),
      last_sync_at: row.last_sync_at ? String(row.last_sync_at) : null,
    }));
    return z.array(RepositoryDetailsSchema).parse(convertedDetails);
  }

  async getRepositoryId(org: string, repo: string): Promise<number> {
    const existingQuery =
      "SELECT repository_id FROM repository WHERE org = $1 AND name = $2";
    const existingResult = await this.sql.unsafe(existingQuery, [org, repo]);

    if (existingResult.length > 0) {
      return Number(existingResult[0].repository_id);
    }

    const insertQuery =
      "INSERT INTO repository (org, name) VALUES ($1, $2) RETURNING repository_id";
    const insertResult = await this.sql.unsafe(insertQuery, [org, repo]);
    return Number(insertResult[0].repository_id);
  }

  async getOrCreateUsers(users: User[]): Promise<Map<number, number>> {
    const resultMap: Map<number, number> = new Map();
    const unknownUsers: User[] = [];

    for (const user of users) {
      const dbUserId = this.userIdMap.get(user.id);
      if (dbUserId !== undefined) {
        resultMap.set(user.id, dbUserId);
      } else {
        unknownUsers.push(user);
      }
    }

    if (unknownUsers.length === 0) {
      return resultMap;
    }

    const userIds = unknownUsers.map((user) => user.id);
    const rows = await this.sql.unsafe(getAllUsers, [userIds]);

    for (const row of rows) {
      const existingUser = unknownUsers.find(
        (user) => user.id === row.gh_user_id,
      );
      if (existingUser) {
        const dbUserId = Number(row.user_id);
        resultMap.set(existingUser.id, dbUserId);
        this.userIdMap.set(existingUser.id, dbUserId);
      }
    }

    for (const user of unknownUsers) {
      if (!resultMap.has(user.id)) {
        const dbUser = await this.sql.unsafe(insertUser, [user.id, user.login]);
        const dbUserId = Number(dbUser[0].user_id);
        resultMap.set(user.id, dbUserId);
        this.userIdMap.set(user.id, dbUserId);
      }
    }

    return resultMap;
  }

  async getLowestIssueId(): Promise<number> {
    const repoId = await this.getRepositoryId(this.org, this.repo);
    const query = `
      SELECT gh_issue_id 
      FROM issue 
      WHERE repository_id = $1 
      ORDER BY gh_issue_id ASC 
      LIMIT 1
    `;
    const result = await this.sql.unsafe(query, [repoId]);
    return Number(result[0]?.gh_issue_id) || 0;
  }

  // Additional methods to implement interface
  async insertIssue(
    issue: HydratedIssue,
    stats: PullRequestEnhancedStats | number,
  ): Promise<void> {
    const enhancedStats =
      typeof stats === "number"
        ? {
            roundsOfReview: stats,
            botRoundsOfReview: 0,
            firstReviewAt: null,
            firstApprovalAt: null,
            firstEffectiveApprovalAt: null,
            mergedAfterPostApprovalCommit: false,
            aiAssistedModel: null,
          }
        : stats;
    const uniqueUsers = this.collectUniqueUsers(issue);
    const ghUserIdToDbUserId = await this.getOrCreateUsers(uniqueUsers);

    // Persist the issue and its related records atomically.
    const _result = await this.sql.begin(async (sql) => {
      const dbUserId = ghUserIdToDbUserId.get(issue.user.id)!;
      const issueRow = await sql.unsafe(upsertIssue, [
        await this.getRepositoryId(this.org, this.repo),
        dbUserId,
        issue.number,
        issue.title,
        issue.state,
        issue.body,
        issue.created_at,
        issue.updated_at,
        issue.closed_at,
        issue.type,
      ]);

      if (issue.type != IssueType.PULL_REQUEST) {
        return;
      }

      if (issue.state == State.OPEN) {
        return;
      }

      const issueId = Number(issueRow[0].issue_id);
      const pr = issue.hydrated_pull_request;
      if (pr === undefined) {
        throw new Error("unexpected undefined pr while inserting");
      }

      const prRow = await sql.unsafe(insertPullRequest, [
        issueId,
        pr.merged_at,
        pr.merge_commit_sha,
        pr.targetBranch,
        pr.sourceBranch,
        pr.comments,
        pr.review_comments,
        pr.commits,
        pr.additions,
        pr.deletions,
        pr.changed_files,
      ]);

      const dbPrId = Number(prRow[0].pull_request_id);

      // Insert reviews
      const reviewRows: SqlValue[][] = pr.reviews.map((review) => {
        if (review.user === null) throw new Error("review user is null");
        const dbUserId = ghUserIdToDbUserId.get(review.user.id)!;
        return [
          dbPrId,
          review.id,
          dbUserId,
          review.body,
          review.author_association,
          review.state,
          review.submitted_at ?? null,
          review.commit_id ?? null,
        ] as SqlValue[];
      });
      for (const batch of chunkByParams(reviewRows, 8)) {
        const { query, values } = buildBulkInsert(
          "pull_request_review",
          [
            "pull_request_id",
            "gh_pull_request_review_id",
            "user_id",
            "body",
            "author_association",
            "state",
            "submitted_at",
            "commit_id",
          ],
          batch,
        );
        await sql.unsafe(query, values);
      }

      // Approximate reaction observation time with insertion time, including fixture replays.
      const reactionsObservedAt = new Date();
      // Insert comments
      const commentRows: SqlValue[][] = pr.commentList.map((comment) => {
        if (comment.user === null) throw new Error("comment user is null");
        const dbUserId = ghUserIdToDbUserId.get(comment.user.id)!;
        return [
          dbPrId,
          comment.id,
          dbUserId,
          comment.path,
          comment.body,
          comment.author_association,
          comment.created_at,
          comment.updated_at,
          comment.pull_request_review_id ?? null,
          comment.in_reply_to_id ?? null,
          comment.line ?? null,
          comment.start_line ?? null,
          comment.original_line ?? null,
          comment.original_start_line ?? null,
          comment.side ?? null,
          comment.start_side ?? null,
          comment.subject_type ?? null,
          comment.commit_id ?? null,
          comment.original_commit_id ?? null,
          comment.diff_hunk ?? null,
          comment.reactions == null ? null : sql.json(comment.reactions),
          comment.reactions == null ? null : reactionsObservedAt,
        ] as SqlValue[];
      });
      for (const batch of chunkByParams(commentRows, 22)) {
        const { query, values } = buildBulkInsert(
          "pull_request_comment",
          [
            "pull_request_id",
            "gh_pull_request_comment_id",
            "user_id",
            "path",
            "body",
            "author_association",
            "created_at",
            "updated_at",
            "gh_pull_request_review_id",
            "gh_in_reply_to_comment_id",
            "line",
            "start_line",
            "original_line",
            "original_start_line",
            "side",
            "start_side",
            "subject_type",
            "commit_id",
            "original_commit_id",
            "diff_hunk",
            "reactions",
            "reactions_observed_at",
          ],
          batch,
        );
        await sql.unsafe(query, values);
      }

      // Insert issue comments
      const issueCommentRows: SqlValue[][] = pr.issueCommentList.map(
        (comment) => {
          if (comment.user === null) throw new Error("comment user is null");
          const dbUserId = ghUserIdToDbUserId.get(comment.user.id)!;
          return [
            issueId,
            comment.id,
            dbUserId,
            comment.body,
            comment.author_association,
            comment.created_at,
            comment.updated_at,
          ] as SqlValue[];
        },
      );
      for (const batch of chunkByParams(issueCommentRows, 7)) {
        const { query, values } = buildBulkInsert(
          "issue_comment",
          [
            "issue_id",
            "gh_issue_comment_id",
            "user_id",
            "body",
            "author_association",
            "created_at",
            "updated_at",
          ],
          batch,
        );
        await sql.unsafe(query, values);
      }

      // Insert commits
      const commitRows: SqlValue[][] = pr.commitList.map((commit) => {
        const dbUserId = ghUserIdToDbUserId.get(commit.user.id)!;
        return [
          dbPrId,
          commit.commitSha,
          commit.commitTitle,
          dbUserId,
          commit.commitTime,
        ] as SqlValue[];
      });
      for (const batch of chunkByParams(commitRows, 5)) {
        const { query, values } = buildBulkInsert(
          "pull_request_commit",
          ["pull_request_id", "sha", "message", "user_id", "committed_at"],
          batch,
        );
        await sql.unsafe(query, values);
      }

      // Insert files
      const fileRows: SqlValue[][] = pr.files.map(
        (file) =>
          [
            dbPrId,
            file.filename,
            file.additions,
            file.deletions,
            file.changes,
            file.status,
            file.previous_filename ?? null,
          ] as SqlValue[],
      );
      for (const batch of chunkByParams(fileRows, 7)) {
        const { query, values } = buildBulkInsert(
          "pull_request_file",
          [
            "pull_request_id",
            "filename",
            "additions",
            "deletions",
            "changes",
            "status",
            "previous_filename",
          ],
          batch,
        );
        await sql.unsafe(query, values);
      }

      // Insert rounds of reviews
      await sql.unsafe(insertRoundOfReviews, [
        dbPrId,
        enhancedStats.roundsOfReview,
      ]);
      await sql.unsafe(insertPullRequestEnhancedStats, [
        dbPrId,
        enhancedStats.roundsOfReview,
        enhancedStats.botRoundsOfReview,
        enhancedStats.firstReviewAt,
        enhancedStats.firstApprovalAt,
        enhancedStats.firstEffectiveApprovalAt,
        enhancedStats.mergedAfterPostApprovalCommit,
        enhancedStats.aiAssistedModel,
      ]);
    });
  }

  async getClosedIssues(): Promise<number[]> {
    const repoId = await this.getRepositoryId(this.org, this.repo);
    const query = `
      SELECT gh_issue_id 
      FROM issue 
      WHERE closed_at IS NOT NULL 
      AND repository_id = $1
    `;
    const result = await this.sql.unsafe(query, [repoId]);
    return result.map((row) => Number(row.gh_issue_id));
  }

  async getOpenNonPullRequestIssues(): Promise<number[]> {
    const repoId = await this.getRepositoryId(this.org, this.repo);
    const query = `
      SELECT gh_issue_id
      FROM issue
      WHERE closed_at IS NULL
      AND repository_id = $1
      AND issue_type_id != $2
    `;
    const result = await this.sql.unsafe(query, [
      repoId,
      IssueType.PULL_REQUEST,
    ]);
    return result.map((row) => Number(row.gh_issue_id));
  }

  async getOpenPullRequestsToSkip(
    userName: string,
    created: Date,
  ): Promise<number[]> {
    const repoId = await this.getRepositoryId(this.org, this.repo);
    const result = await this.sql.unsafe(getOpenPullRequestsToSkip, [
      repoId,
      userName,
      created.toISOString(),
    ]);
    return result.map((row) => Number(row.gh_issue_id));
  }

  async getAllProcessedPullRequests(userName: string): Promise<number[]> {
    const repoId = await this.getRepositoryId(this.org, this.repo);
    const result = await this.sql.unsafe(getAllProcessedPullRequests, [
      repoId,
      userName,
    ]);
    return result.map((row) => Number(row.gh_issue_id));
  }

  async getFullIssue(
    ghIssueNumber: number,
  ): Promise<FullIssue | FullPullRequest> {
    const {
      FullIssueSchema,
      FullPullRequestSchema,
      DbIssueSchema,
      DbUserSchema,
      PostgresPullRequestSchema,
      DbFileSchema,
      DbCommentSchema,
      DbCommitSchema,
      DbReviewSchema,
    } = await import("../models/dbTypes.ts");

    const issueRow = await this.getIssue(ghIssueNumber);
    const issue = FullIssueSchema.parse({
      ...DbIssueSchema.parse(issueRow),
      user: DbUserSchema.parse(issueRow),
    });

    const pr = await this.getPullRequest(issue._id);
    if (pr === undefined) {
      return issue;
    }

    const prId = PostgresPullRequestSchema.parse(pr)._pr_id;
    const [fileRows, commentRows, issueCommentRows, commitRows, reviewRows] =
      await Promise.all([
        this.getFiles(prId),
        this.getComments(prId),
        this.getIssueComments(issue._id),
        this.getCommits(prId),
        this.getReviews(prId),
      ]);

    const pullRequest = FullPullRequestSchema.parse({
      ...PostgresPullRequestSchema.parse(pr),
      ...issue,
      files: fileRows.map((row) =>
        DbFileSchema.parse({
          ...row,
          additions: Number(row.additions),
          deletions: Number(row.deletions),
          changes: Number(row.changes),
        }),
      ),
      reviewComments: commentRows.map((row) => {
        return {
          ...DbCommentSchema.parse({
            ...row,
            created_at:
              row.created_at instanceof Date
                ? row.created_at.toISOString()
                : row.created_at,
            updated_at:
              row.updated_at instanceof Date
                ? row.updated_at.toISOString()
                : row.updated_at,
          }),
          user: DbUserSchema.parse(row),
        };
      }),
      issueComments: issueCommentRows.map((row) => {
        return {
          ...DbCommentSchema.parse({
            ...row,
            created_at:
              row.created_at instanceof Date
                ? row.created_at.toISOString()
                : row.created_at,
            updated_at:
              row.updated_at instanceof Date
                ? row.updated_at.toISOString()
                : row.updated_at,
          }),
          user: DbUserSchema.parse(row),
        };
      }),
      commits: commitRows.map((row) => {
        return {
          ...DbCommitSchema.parse({
            ...row,
            committed_at:
              row.committed_at instanceof Date
                ? row.committed_at.toISOString()
                : row.committed_at,
          }),
          user: DbUserSchema.parse(row),
        };
      }),
      reviews: reviewRows.map((row) => {
        return {
          ...DbReviewSchema.parse({
            ...row,
            submitted_at:
              row.submitted_at instanceof Date
                ? row.submitted_at.toISOString()
                : row.submitted_at,
          }),
          user: DbUserSchema.parse(row),
        };
      }),
    });
    return pullRequest;
  }

  async getIssue(ghIssueNumber: number): Promise<DbRow> {
    const { PostgresIssueWithUserSchema } =
      await import("../models/dbTypes.ts");

    const repoId = await this.getRepositoryId(this.org, this.repo);
    const query = `
      SELECT 
        issue.issue_id as _id,
        issue.gh_issue_id as id,
        issue.title,
        issue.state,
        issue.body,
        issue.created_at,
        issue.updated_at,
        issue.closed_at,
        "user".user_id,
        "user".gh_login as name
      FROM issue
      INNER JOIN "user" ON "user".user_id = issue.user_id
      WHERE issue.gh_issue_id = $1 AND issue.repository_id = $2
    `;

    const result = await this.sql.unsafe(query, [ghIssueNumber, repoId]);
    if (result.length === 0) {
      throw new Error(`Issue ${ghIssueNumber} not found`);
    }

    return PostgresIssueWithUserSchema.parse(result[0]);
  }

  async getReviewerStats(
    startDate: Date,
    endDate: Date,
    repositoryId: number,
    reviewerUsernames?: string[],
  ): Promise<ReviewerStats[]> {
    return await new ReportsRepository(this.sql).getReviewerStats(
      startDate,
      endDate,
      [repositoryId],
      reviewerUsernames,
    );
  }

  async getUserActivity(repositoryId: number): Promise<UserActivity[]> {
    const rawRows = await this.sql.unsafe(getUserActivity, [repositoryId]);
    return z.array(UserActivitySchema).parse(rawRows);
  }

  async updateUserActivity(): Promise<void> {
    const repositoryId = await this.getRepositoryId(this.org, this.repo);

    try {
      await this.sql.begin(async (tx) => {
        await createTempUserActivityTable(tx);
        await populateTempUserActivity(tx, repositoryId);
        await indexTempUserActivity(tx);
        await deleteOldUserActivity(tx, repositoryId);
        await insertNewUserActivity(tx);
        await dropTempUserActivityTable(tx);
      });
    } catch (error) {
      console.error("Error during user activity update:", error);
      throw error;
    }
  }

  async getAuthorStats(
    startDate: Date,
    endDate: Date,
    repositoryId: number,
    authorUsernames?: string[],
  ): Promise<AuthorStats[]> {
    return await new ReportsRepository(this.sql).getAuthorStats(
      startDate,
      endDate,
      [repositoryId],
      authorUsernames,
    );
  }

  async getContributorAgeBuckets(
    startDate: Date,
    endDate: Date,
    repositoryId: number,
  ): Promise<Array<{ bucket: string; count: number }>> {
    const rows = await this.sql.unsafe(getContributorAgeBuckets, [
      repositoryId,
      startDate.toISOString(),
      endDate.toISOString(),
    ]);
    return rows.map((row) => ({
      bucket: String(row.bucket),
      count: Number(row.count),
    }));
  }

  async getDailyMergeMetrics(
    startDate: Date,
    endDate: Date,
    repositoryId: number,
  ): Promise<MergesByDay[]> {
    const rawData = await this.sql.unsafe(getMergesByDay, [
      repositoryId,
      startDate.toISOString(),
      endDate.toISOString(),
    ]);
    return z.array(MergesByDaySchema).parse(rawData);
  }

  async getMergedPrTiming(
    startDate: Date,
    endDate: Date,
    repositoryId: number,
  ): Promise<PrTiming[]> {
    const rawData = await getMergedPrTiming(
      this.sql,
      repositoryId,
      startDate,
      endDate,
    );
    return z.array(PrTimingSchema).parse(rawData);
  }

  // TODO: Should userId be passed in? Perhaps service.ts maps to userId
  async getUserStatsForUi(
    repositoryId: number,
    username: string,
  ): Promise<UserStatsForUi> {
    const [stats, repoInfo] = await Promise.all([
      this.sql.unsafe(getUserStats, [repositoryId, username]),
      this.sql.unsafe(getRepositoryInfo, [repositoryId]),
    ]);

    return UserStatsForUiSchema.parse({
      ...stats[0],
      repo_owner: repoInfo[0].org,
      repo_name: repoInfo[0].name,
      first_seen_timestamp: stats[0]?.first_seen_timestamp ?? null,
      last_seen_timestamp: stats[0]?.last_seen_timestamp ?? null,
      user_position: stats[0]?.user_position ?? 0,
      total_unique_users: stats[0]?.total_unique_users ?? 0,
    });
  }

  async getUserPullStats(
    repositoryId: number,
    username: string,
    limit: number,
    offset: number = 0,
  ): Promise<UserPullStatsDb> {
    const [recentPulls, repoInfo] = await Promise.all([
      this.sql.unsafe(getRecentPulls, [repositoryId, username, limit, offset]),
      this.sql.unsafe(getRepositoryInfo, [repositoryId]),
    ]);

    return UserPullStatsDbSchema.parse({
      recent_pulls: z.array(RecentPullSchema).parse(recentPulls),
      repo_owner: repoInfo[0].org,
      repo_name: repoInfo[0].name,
    });
  }

  async getUserIssueReviews(
    repositoryId: number,
    username: string,
    limit: number,
    offset: number = 0,
  ): Promise<UserIssueStats> {
    // Get repository info for response
    const repoInfo = await this.sql.unsafe(getRepositoryInfo, [repositoryId]);

    // Get user_id from username first
    const userQuery = this.sql`
      SELECT user_id FROM "user" WHERE gh_login = ${username}
    `;
    const userResult = await userQuery;
    if (userResult.length === 0) {
      return UserIssueStatsSchema.parse({
        recent_issue_reviews: [],
        repo_owner: repoInfo[0].org,
        repo_name: repoInfo[0].name,
      });
    }
    const userId = userResult[0].user_id;

    const issueReviews = await getUserIssueReviews(
      this.sql,
      userId,
      repositoryId,
      limit,
      offset,
    );

    return UserIssueStatsSchema.parse({
      recent_issue_reviews: z
        .array(RecentIssueReviewSchema)
        .parse(issueReviews),
      repo_owner: repoInfo[0].org,
      repo_name: repoInfo[0].name,
    });
  }

  collectUniqueUsers(issue: HydratedIssue): User[] {
    const userMap: Map<string, User> = new Map();

    const addUser = (user: User) => {
      const key = `${user.id}_${user.login}`;
      if (!userMap.has(key)) {
        userMap.set(key, user);
      }
    };

    addUser(issue.user);
    if (!issue.hydrated_pull_request) {
      return Array.from(userMap.values());
    }
    const pr = issue.hydrated_pull_request;
    addUser(pr.user);

    if (pr.reviews) {
      pr.reviews.forEach((review) => {
        // Todo clean up these null checks after newer zod model doesnt allow
        if (review.user === null) throw new Error("review user is null");
        addUser(review.user);
      });
    }

    if (pr.commentList) {
      pr.commentList.forEach((comment) => {
        if (comment.user === null) throw new Error("comment user is null");
        addUser(comment.user);
      });
    }

    if (pr.issueCommentList) {
      pr.issueCommentList.forEach((comment) => {
        if (comment.user === null) throw new Error("comment user is null");
        addUser(comment.user);
      });
    }

    if (pr.commitList) {
      pr.commitList.forEach((commit) => {
        addUser(commit.user);
      });
    }

    return Array.from(userMap.values());
  }

  async getUserActivityOverview(
    repositoryId: number,
  ): Promise<UserActivityOverview[]> {
    const rawData = await this.sql.unsafe(debugUserActivity, [repositoryId]);
    return z.array(UserActivityOverviewSchema).parse(rawData);
  }

  private async getPullRequest(issueId: number): Promise<DbRow | undefined> {
    const query = `
      SELECT 
        pull_request.pull_request_id as _pr_id,
        pull_request.merged_at,
        pull_request.target_branch,
        pull_request.source_branch,
        pull_request.additions,
        pull_request.deletions,
        pull_request.changed_files,
        pull_request.commit_count,
        pull_request.comment_count,
        pull_request.review_comment_count,
        pull_request.merge_commit_sha,
        pull_request_round_of_review.rounds as rounds_of_review
      FROM pull_request
      INNER JOIN pull_request_round_of_review ON pull_request_round_of_review.pull_request_id = pull_request.pull_request_id
      WHERE pull_request.issue_id = $1
    `;

    const result = await this.sql.unsafe(query, [issueId]);
    return result.length > 0 ? result[0] : undefined;
  }

  private async getFiles(prId: number): Promise<DbRow[]> {
    const query = `
      SELECT 
        filename,
        status,
        additions,
        deletions,
        changes
      FROM pull_request_file
      WHERE pull_request_id = $1
    `;

    return await this.sql.unsafe(query, [prId]);
  }

  private async getCommits(prId: number): Promise<DbRow[]> {
    const query = `
      SELECT 
        pull_request_commit.message,
        pull_request_commit.committed_at,
        "user".gh_login as name
      FROM pull_request_commit
      INNER JOIN "user" ON "user".user_id = pull_request_commit.user_id
      WHERE pull_request_commit.pull_request_id = $1
    `;

    return await this.sql.unsafe(query, [prId]);
  }

  private async getComments(prId: number): Promise<DbRow[]> {
    const query = `
      SELECT 
        pull_request_comment.path,
        pull_request_comment.body,
        pull_request_comment.author_association,
        pull_request_comment.created_at,
        pull_request_comment.updated_at,
        "user".gh_login as name
      FROM pull_request_comment
      INNER JOIN "user" ON "user".user_id = pull_request_comment.user_id
      WHERE pull_request_comment.pull_request_id = $1
    `;

    return await this.sql.unsafe(query, [prId]);
  }

  private async getIssueComments(issueId: number): Promise<DbRow[]> {
    const query = `
      SELECT 
        issue_comment.body,
        issue_comment.author_association,
        issue_comment.created_at,
        issue_comment.updated_at,
        "user".gh_login as name
      FROM issue_comment
      INNER JOIN "user" ON "user".user_id = issue_comment.user_id
      WHERE issue_comment.issue_id = $1
    `;

    return await this.sql.unsafe(query, [issueId]);
  }

  private async getReviews(prId: number): Promise<DbRow[]> {
    const query = `
      SELECT 
        pull_request_review.body,
        pull_request_review.author_association,
        pull_request_review.state,
        pull_request_review.submitted_at,
        "user".gh_login as name
      FROM pull_request_review
      INNER JOIN "user" ON "user".user_id = pull_request_review.user_id
      WHERE pull_request_review.pull_request_id = $1
    `;

    return await this.sql.unsafe(query, [prId]);
  }

  async getRenamedFilesForBackfill(
    repositoryId: number,
    limit: number,
  ): Promise<RenamedFileForBackfill[]> {
    const rawData = await this.sql.unsafe(getRenamedFilesForBackfill, [
      repositoryId,
      limit,
    ]);
    return z.array(RenamedFileForBackfillSchema).parse(rawData);
  }

  async updatePreviousFilename(
    pullRequestFileId: number,
    previousFilename: string,
  ): Promise<void> {
    await this.sql.unsafe(updatePreviousFilename, [
      previousFilename,
      pullRequestFileId,
    ]);
  }

  async getDirectoryStats(
    repositoryId: number,
    directoryPath: string,
  ): Promise<FileSystemActivity[]> {
    // Handle empty path (all files) vs specific directory
    let whereClause: string;
    let params: (string | number)[];

    const defaultBranchFilter = "LOWER(pr.target_branch) IN ('main', 'master')";

    if (directoryPath === "") {
      // Get all files in the repository
      whereClause = `
        WHERE
          i.repository_id = $1
          AND pr.merged_at IS NOT NULL
          AND ${defaultBranchFilter}
      `;
      params = [repositoryId];
    } else {
      // Get files in specific directory
      const directoryPattern = directoryPath.endsWith("/")
        ? directoryPath + "%"
        : directoryPath + "/%";
      whereClause = `
        WHERE
          i.repository_id = $1
          AND pr.merged_at IS NOT NULL
          AND ${defaultBranchFilter}
          AND (prf.filename LIKE $2 OR prf.previous_filename LIKE $2)
      `;
      params = [repositoryId, directoryPattern];
    }

    const query = `
      SELECT
        u.user_id,
        u.gh_login,
        prf.pull_request_file_id,
        prf.pull_request_id,
        prf.filename,
        prf.status,
        prf.additions,
        prf.deletions,
        prf.changes,
        prf.previous_filename,
        prf.inserted_at,
        pr.merged_at,
        pr.source_branch,
        pr.target_branch,
        i.gh_issue_id,
        i.title
      FROM
        issue i
        JOIN "user" u USING (user_id)
        JOIN pull_request pr USING (issue_id)
        JOIN pull_request_file prf USING (pull_request_id)
      ${whereClause}
      ORDER BY
        pr.merged_at ASC, prf.pull_request_file_id ASC
    `;

    const rawData = await this.sql.unsafe(query, params);
    return z.array(FileSystemActivitySchema).parse(rawData);
  }

  async updateRepositoryOverview(repositoryId: number): Promise<void> {
    try {
      await updateRepositoryOverview(this.sql, repositoryId);
    } catch (error) {
      console.error("Error during repository overview update:", error);
      throw error;
    }
  }

  async getRepositoryOverview(
    repositoryId: number,
  ): Promise<ComputedRepositoryOverview | null> {
    const result = await getRepositoryOverview(this.sql, repositoryId);

    if (result.length === 0) {
      return null;
    }

    return ComputedRepositoryOverviewSchema.parse(result[0]);
  }

  async persistFileSystem(
    repositoryId: number,
    nodes: ComputedFileSystemNode[],
  ): Promise<void> {
    try {
      await this.sql.begin(async (tx) => {
        // Delete existing filesystem data for this repository
        await deleteOldFileSystem(tx, repositoryId);

        // Insert new filesystem nodes in batch
        if (nodes.length > 0) {
          await insertFileSystemNodes(tx, nodes);
        }
      });
    } catch (error) {
      console.error("Error during filesystem persistence:", error);
      throw error;
    }
  }

  async getFileSystemNodes(
    repositoryId: number,
    parentPath: string,
    levels: number[],
  ): Promise<ComputedFileSystemNode[]> {
    const rawData = await getFileSystemNodes(
      this.sql,
      repositoryId,
      parentPath,
      levels,
    );
    return z.array(ComputedFileSystemNodeSchema).parse(rawData);
  }

  async getFileSystemNodeByPath(
    repositoryId: number,
    path: string,
  ): Promise<ComputedFileSystemNode | null> {
    const rawData = await getFileSystemNodeByPath(this.sql, repositoryId, path);
    const parsed = z.array(ComputedFileSystemNodeSchema).parse(rawData);
    return parsed[0] ?? null;
  }

  private parseMonthlyMetricRows(
    rows: Record<string, unknown>[],
  ): MonthlyMetricPoint[] {
    return rows.map((row) =>
      MonthlyMetricPointSchema.parse({
        month:
          row.month instanceof Date
            ? row.month.toISOString().slice(0, 7)
            : String(row.month).slice(0, 7),
        value: Number(row.value),
      }),
    );
  }

  async getUserMonthlyMergedPrs(
    repositoryId: number,
    username: string,
  ): Promise<MonthlyMetricPoint[]> {
    const rawData = await this.sql.unsafe(getUserMonthlyMergedPrs, [
      repositoryId,
      username,
    ]);
    return this.parseMonthlyMetricRows(rawData);
  }

  async getUserMonthlyLinesModified(
    repositoryId: number,
    username: string,
  ): Promise<MonthlyMetricPoint[]> {
    const rawData = await this.sql.unsafe(getUserMonthlyLinesModified, [
      repositoryId,
      username,
    ]);
    return this.parseMonthlyMetricRows(rawData);
  }

  async getUserMonthlyPrsReviewed(
    repositoryId: number,
    username: string,
  ): Promise<MonthlyMetricPoint[]> {
    const rawData = await getUserMonthlyPrsReviewed(
      this.sql,
      repositoryId,
      username,
    );
    return this.parseMonthlyMetricRows(rawData);
  }

  async getUserMonthlyPrComments(
    repositoryId: number,
    username: string,
  ): Promise<MonthlyMetricPoint[]> {
    const rawData = await getUserMonthlyPrComments(
      this.sql,
      repositoryId,
      username,
    );
    return this.parseMonthlyMetricRows(rawData);
  }

  async getFileSystemPRs(
    repositoryId: number,
    path: string,
    type: "file" | "folder",
    limit: number,
    offset: number,
  ): Promise<FileSystemPR[]> {
    const rawData = await getFileSystemPRs(
      this.sql,
      repositoryId,
      path,
      type,
      limit,
      offset,
    );
    return z.array(FileSystemPRSchema).parse(rawData);
  }

  // ── GitHub profile sync ───────────────────────────────────────────

  /**
   * Return users that have no profile row, still have a legacy avatar-only
   * row, or have not had their profile refreshed since the cutoff.
   */
  async getUsersNeedingProfileSync(
    profileCutoffDate: Date,
  ): Promise<Array<{ user_id: number; gh_login: string }>> {
    const rows = await this.sql.unsafe(
      `
      SELECT u.user_id, u.gh_login
      FROM "user" u
      LEFT JOIN github_user_profile gup ON gup.user_id = u.user_id
      WHERE gup.profile_id IS NULL
         OR gup.synced_at < $1
         OR (
           gup.avatar_url IS NOT NULL
           AND gup.github_created_at IS NULL
           AND gup.name IS NULL
           AND gup.company IS NULL
           AND gup.location IS NULL
           AND gup.email IS NULL
         )
      ORDER BY u.user_id
    `,
      [profileCutoffDate],
    );
    return rows.map((r) => ({
      user_id: Number(r.user_id),
      gh_login: String(r.gh_login),
    }));
  }

  /**
   * Return users that have never had a GitHub profile row synced.
   */
  async getUsersMissingProfileSync(): Promise<
    Array<{ user_id: number; gh_login: string }>
  > {
    const rows = await this.sql.unsafe(`
      SELECT u.user_id, u.gh_login
      FROM "user" u
      LEFT JOIN github_user_profile gup ON gup.user_id = u.user_id
      WHERE gup.profile_id IS NULL
      ORDER BY u.user_id
    `);
    return rows.map((r) => ({
      user_id: Number(r.user_id),
      gh_login: String(r.gh_login),
    }));
  }

  /**
   * Read the current profile row for a user (if any).
   */
  async getUserProfile(
    userId: number,
  ): Promise<StoredGithubUserProfile | null> {
    const rows = await this.sql.unsafe(
      `SELECT profile_id, avatar_url, name, company, location, email, github_created_at
       FROM github_user_profile
       WHERE user_id = $1`,
      [userId],
    );
    if (rows.length === 0) return null;
    return this.mapStoredGithubUserProfile(rows[0]);
  }

  /**
   * Read the current profile by gh_login (for the API read path).
   */
  async getUserProfileByLogin(
    ghLogin: string,
  ): Promise<(GithubUserProfileSnapshot & { synced_at: string }) | null> {
    const rows = await this.sql.unsafe(
      `SELECT gup.avatar_url, gup.name, gup.company, gup.location, gup.email,
              gup.github_created_at, gup.synced_at
       FROM github_user_profile gup
       JOIN "user" u ON u.user_id = gup.user_id
       WHERE u.gh_login = $1`,
      [ghLogin],
    );
    if (rows.length === 0) return null;
    return {
      avatar_url: rows[0].avatar_url ? String(rows[0].avatar_url) : null,
      name: rows[0].name === null ? null : String(rows[0].name),
      company: rows[0].company === null ? null : String(rows[0].company),
      location: rows[0].location === null ? null : String(rows[0].location),
      email: rows[0].email === null ? null : String(rows[0].email),
      github_created_at:
        rows[0].github_created_at === null
          ? null
          : new Date(rows[0].github_created_at as string | Date).toISOString(),
      synced_at: String(rows[0].synced_at),
    };
  }

  /**
   * Insert a brand-new profile row.
   */
  async insertUserProfile(
    userId: number,
    profile: GithubUserProfileSnapshot,
  ): Promise<void> {
    const normalizedProfile = normalizeGithubUserProfileSnapshot(profile);

    await this.sql.unsafe(
      `INSERT INTO github_user_profile (
         user_id,
         avatar_url,
         name,
         company,
         location,
         email,
         github_created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id) DO UPDATE SET
         avatar_url = EXCLUDED.avatar_url,
         name = EXCLUDED.name,
         company = EXCLUDED.company,
         location = EXCLUDED.location,
         email = EXCLUDED.email,
         github_created_at = EXCLUDED.github_created_at,
         synced_at = now()`,
      [
        userId,
        normalizedProfile.avatar_url,
        normalizedProfile.name,
        normalizedProfile.company,
        normalizedProfile.location,
        normalizedProfile.email,
        normalizedProfile.github_created_at,
      ],
    );
  }

  /**
   * If any tracked field changed: archive the old row, then update in place.
   * If nothing changed: just touch synced_at.
   */
  async upsertUserProfile(
    userId: number,
    profile: GithubUserProfileSnapshot,
  ): Promise<{ changed: boolean }> {
    const normalizedProfile = normalizeGithubUserProfileSnapshot(profile);
    const existing = await this.getUserProfile(userId);

    if (!existing) {
      await this.insertUserProfile(userId, normalizedProfile);
      return { changed: true };
    }

    if (!githubUserProfilesDiffer(existing, normalizedProfile)) {
      // Nothing changed — just mark as freshly checked
      await this.sql.unsafe(
        `UPDATE github_user_profile SET synced_at = now() WHERE profile_id = $1`,
        [existing.profile_id],
      );
      return { changed: false };
    }

    // Profile changed — archive old, update current
    await this.sql.unsafe(
      `INSERT INTO github_user_profile_history (
         user_id,
         avatar_url,
         name,
         company,
         location,
         email,
         github_created_at,
         synced_at
       )
       SELECT user_id, avatar_url, name, company, location, email,
              github_created_at, synced_at
       FROM github_user_profile
       WHERE profile_id = $1`,
      [existing.profile_id],
    );

    await this.sql.unsafe(
      `UPDATE github_user_profile
       SET avatar_url = $1,
           name = $2,
           company = $3,
           location = $4,
           email = $5,
           github_created_at = $6,
           synced_at = now()
       WHERE profile_id = $7`,
      [
        normalizedProfile.avatar_url,
        normalizedProfile.name,
        normalizedProfile.company,
        normalizedProfile.location,
        normalizedProfile.email,
        normalizedProfile.github_created_at,
        existing.profile_id,
      ],
    );

    return { changed: true };
  }

  private mapStoredGithubUserProfile(row: DbRow): StoredGithubUserProfile {
    return {
      profile_id: Number(row.profile_id),
      avatar_url: row.avatar_url === null ? null : String(row.avatar_url),
      name: row.name === null ? null : String(row.name),
      company: row.company === null ? null : String(row.company),
      location: row.location === null ? null : String(row.location),
      email: row.email === null ? null : String(row.email),
      github_created_at:
        row.github_created_at === null
          ? null
          : new Date(row.github_created_at as string | Date).toISOString(),
    };
  }
}
