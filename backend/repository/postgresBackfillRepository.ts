import { SqlClient } from "./sqlClient.ts";
import { HydratedIssue } from "../models/gh/issue.ts";
import { IssueType } from "../models/gh/issueType.ts";
import { State } from "../models/gh/state.ts";
import { AuthorAssociation } from "../models/gh/authorAssociation.ts";
import { ReviewState } from "../models/gh/review.ts";
import type { Comment } from "../models/gh/comment.ts";

export type BackfillPullRequestBatchRow = {
  pullRequestId: number;
  ghIssueNumber: number;
  createdAt: Date;
};

type BasePullRequestRow = {
  pull_request_id: number | string;
  issue_id: number | string;
  gh_issue_id: number | string;
  title: string;
  body: string | null;
  state: string;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
  merged_at: Date | null;
  merge_commit_sha: string | null;
  target_branch: string;
  source_branch: string;
  comment_count: number | string;
  review_comment_count: number | string;
  commit_count: number | string;
  additions: number | string;
  deletions: number | string;
  changed_files: number | string;
  author_gh_user_id: number | string;
  author_login: string;
};

type ReviewCommentRow = Pick<
  Comment,
  | "line"
  | "start_line"
  | "original_line"
  | "original_start_line"
  | "side"
  | "start_side"
  | "subject_type"
  | "commit_id"
  | "original_commit_id"
  | "diff_hunk"
  | "reactions"
> & {
  gh_pull_request_review_id: number | string | null;
  gh_in_reply_to_comment_id: number | string | null;
  reactions_observed_at: Date | null;
  pull_request_id: number | string;
  gh_pull_request_comment_id: number | string;
  path: string;
  body: string;
  created_at: Date;
  updated_at: Date;
  author_association: string;
  gh_user_id: number | string;
  gh_login: string;
};

type IssueCommentRow = {
  issue_id: number | string;
  gh_issue_comment_id: number | string;
  body: string;
  created_at: Date;
  updated_at: Date;
  author_association: string;
  gh_user_id: number | string;
  gh_login: string;
};

type ReviewRow = {
  pull_request_id: number | string;
  gh_pull_request_review_id: number | string;
  body: string | null;
  state: string;
  submitted_at: Date | null;
  commit_id: string | null;
  author_association: string;
  gh_user_id: number | string;
  gh_login: string;
};

type CommitRow = {
  pull_request_id: number | string;
  sha: string;
  message: string;
  committed_at: Date;
  gh_user_id: number | string;
  gh_login: string;
};

export type PullRequestEnhancedStatsInsertRow = {
  pullRequestId: number;
  roundsOfReview: number;
  botRoundsOfReview: number;
  firstReviewAt: Date | null;
  firstApprovalAt: Date | null;
  firstEffectiveApprovalAt: Date | null;
  mergedAfterPostApprovalCommit: boolean;
  aiAssistedModel: string | null;
};

export class PostgresBackfillRepository {
  constructor(private readonly sql: SqlClient) {}

  async getRepositoryId(org: string, repo: string): Promise<number> {
    const rows = await this.sql.unsafe(
      `SELECT repository_id FROM repository WHERE org = $1 AND name = $2`,
      [org, repo],
    );
    if (rows.length === 0) {
      throw new Error(`Repository ${org}/${repo} not found`);
    }
    return Number(rows[0].repository_id);
  }

  async getClosedPullRequestBatch(
    repositoryId: number,
    limit: number,
    offset: number,
  ): Promise<BackfillPullRequestBatchRow[]> {
    const rows = await this.sql.unsafe(
      `
        SELECT
          pr.pull_request_id,
          i.gh_issue_id,
          i.created_at
        FROM issue i
        INNER JOIN pull_request pr ON pr.issue_id = i.issue_id
        WHERE i.repository_id = $1
          AND i.closed_at IS NOT NULL
        ORDER BY i.gh_issue_id DESC
        LIMIT $2 OFFSET $3
      `,
      [repositoryId, limit, offset],
    );

    return rows.map((row) => ({
      pullRequestId: Number(row.pull_request_id),
      ghIssueNumber: Number(row.gh_issue_id),
      createdAt: new Date(row.created_at),
    }));
  }

  async getHydratedIssuesForEnhancedStatsBackfill(
    repositoryId: number,
    pullRequestNumbers: number[],
  ): Promise<Map<number, { pullRequestId: number; issue: HydratedIssue }>> {
    if (pullRequestNumbers.length === 0) {
      return new Map();
    }

    const baseRows = await this.sql.unsafe<BasePullRequestRow[]>(
      `
        SELECT
          pr.pull_request_id,
          i.issue_id,
          i.gh_issue_id,
          i.title,
          i.body,
          i.state,
          i.created_at,
          i.updated_at,
          i.closed_at,
          pr.merged_at,
          pr.merge_commit_sha,
          pr.target_branch,
          pr.source_branch,
          pr.comment_count,
          pr.review_comment_count,
          pr.commit_count,
          pr.additions,
          pr.deletions,
          pr.changed_files,
          u.gh_user_id AS author_gh_user_id,
          u.gh_login AS author_login
        FROM issue i
        INNER JOIN pull_request pr ON pr.issue_id = i.issue_id
        INNER JOIN "user" u ON u.user_id = i.user_id
        WHERE i.repository_id = $1
          AND i.gh_issue_id = ANY($2)
      `,
      [repositoryId, pullRequestNumbers],
    );

    if (baseRows.length === 0) {
      return new Map();
    }

    const pullRequestIds = baseRows.map((row) => Number(row.pull_request_id));
    const issueIds = baseRows.map((row) => Number(row.issue_id));

    const [reviewCommentRows, issueCommentRows, reviewRows, commitRows] =
      await Promise.all([
        this.sql.unsafe<ReviewCommentRow[]>(
          `
            SELECT
              prc.pull_request_id,
              prc.gh_pull_request_comment_id,
              prc.gh_pull_request_review_id,
              prc.gh_in_reply_to_comment_id,
              prc.line,
              prc.start_line,
              prc.original_line,
              prc.original_start_line,
              prc.side,
              prc.start_side,
              prc.subject_type,
              prc.commit_id,
              prc.original_commit_id,
              prc.diff_hunk,
              prc.reactions,
              prc.reactions_observed_at,
              prc.path,
              prc.body,
              prc.created_at,
              prc.updated_at,
              prc.author_association,
              u.gh_user_id,
              u.gh_login
            FROM pull_request_comment prc
            INNER JOIN "user" u ON u.user_id = prc.user_id
            WHERE prc.pull_request_id = ANY($1)
            ORDER BY prc.created_at ASC
          `,
          [pullRequestIds],
        ),
        this.sql.unsafe<IssueCommentRow[]>(
          `
            SELECT
              ic.issue_id,
              ic.gh_issue_comment_id,
              ic.body,
              ic.created_at,
              ic.updated_at,
              ic.author_association,
              u.gh_user_id,
              u.gh_login
            FROM issue_comment ic
            INNER JOIN "user" u ON u.user_id = ic.user_id
            WHERE ic.issue_id = ANY($1)
            ORDER BY ic.created_at ASC
          `,
          [issueIds],
        ),
        this.sql.unsafe<ReviewRow[]>(
          `
            SELECT
              prr.pull_request_id,
              prr.gh_pull_request_review_id,
              prr.body,
              prr.state,
              prr.submitted_at,
              prr.commit_id,
              prr.author_association,
              u.gh_user_id,
              u.gh_login
            FROM pull_request_review prr
            INNER JOIN "user" u ON u.user_id = prr.user_id
            WHERE prr.pull_request_id = ANY($1)
            ORDER BY prr.submitted_at ASC NULLS LAST
          `,
          [pullRequestIds],
        ),
        this.sql.unsafe<CommitRow[]>(
          `
            SELECT
              prc.pull_request_id,
              prc.sha,
              prc.message,
              prc.committed_at,
              u.gh_user_id,
              u.gh_login
            FROM pull_request_commit prc
            INNER JOIN "user" u ON u.user_id = prc.user_id
            WHERE prc.pull_request_id = ANY($1)
            ORDER BY prc.committed_at ASC
          `,
          [pullRequestIds],
        ),
      ]);

    const reviewCommentsByPrId = groupBy(reviewCommentRows, (row) =>
      Number(row.pull_request_id),
    );
    const issueCommentsByIssueId = groupBy(issueCommentRows, (row) =>
      Number(row.issue_id),
    );
    const reviewsByPrId = groupBy(reviewRows, (row) =>
      Number(row.pull_request_id),
    );
    const commitsByPrId = groupBy(commitRows, (row) =>
      Number(row.pull_request_id),
    );

    const issues = new Map<
      number,
      { pullRequestId: number; issue: HydratedIssue }
    >();

    for (const row of baseRows) {
      const pullRequestId = Number(row.pull_request_id);
      const issueId = Number(row.issue_id);
      const ghIssueNumber = Number(row.gh_issue_id);
      const author = {
        id: Number(row.author_gh_user_id),
        login: row.author_login,
      };

      issues.set(ghIssueNumber, {
        pullRequestId,
        issue: {
          number: ghIssueNumber,
          title: row.title,
          body: row.body,
          state: normalizeState(row.state),
          created_at: new Date(row.created_at),
          updated_at: new Date(row.updated_at),
          closed_at: row.closed_at ? new Date(row.closed_at) : null,
          user: author,
          type: IssueType.PULL_REQUEST,
          hydrated_pull_request: {
            number: ghIssueNumber,
            title: row.title,
            body: row.body,
            state: normalizeState(row.state),
            created_at: new Date(row.created_at),
            updated_at: new Date(row.updated_at),
            closed_at: row.closed_at ? new Date(row.closed_at) : null,
            merged_at: row.merged_at ? new Date(row.merged_at) : null,
            merge_commit_sha: row.merge_commit_sha,
            user: author,
            sourceBranch: row.source_branch,
            targetBranch: row.target_branch,
            comments: Number(row.comment_count),
            review_comments: Number(row.review_comment_count),
            commits: Number(row.commit_count),
            additions: Number(row.additions),
            deletions: Number(row.deletions),
            changed_files: Number(row.changed_files),
            commentList: (reviewCommentsByPrId.get(pullRequestId) ?? []).map(
              (comment) => ({
                id: Number(comment.gh_pull_request_comment_id),
                pull_request_review_id:
                  comment.gh_pull_request_review_id == null
                    ? null
                    : Number(comment.gh_pull_request_review_id),
                in_reply_to_id:
                  comment.gh_in_reply_to_comment_id == null
                    ? null
                    : Number(comment.gh_in_reply_to_comment_id),
                line: comment.line,
                start_line: comment.start_line,
                original_line: comment.original_line,
                original_start_line: comment.original_start_line,
                side: comment.side,
                start_side: comment.start_side,
                subject_type: comment.subject_type,
                commit_id: comment.commit_id,
                original_commit_id: comment.original_commit_id,
                diff_hunk: comment.diff_hunk,
                reactions: comment.reactions,
                reactions_observed_at: comment.reactions_observed_at
                  ? new Date(comment.reactions_observed_at)
                  : null,
                path: comment.path,
                body: comment.body,
                user: {
                  id: Number(comment.gh_user_id),
                  login: comment.gh_login,
                },
                created_at: new Date(comment.created_at),
                updated_at: new Date(comment.updated_at),
                author_association: normalizeAuthorAssociation(
                  comment.author_association,
                ),
              }),
            ),
            issueCommentList: (issueCommentsByIssueId.get(issueId) ?? []).map(
              (comment) => ({
                id: Number(comment.gh_issue_comment_id),
                body: comment.body,
                user: {
                  id: Number(comment.gh_user_id),
                  login: comment.gh_login,
                },
                created_at: new Date(comment.created_at),
                updated_at: new Date(comment.updated_at),
                author_association: normalizeAuthorAssociation(
                  comment.author_association,
                ),
              }),
            ),
            reviews: (reviewsByPrId.get(pullRequestId) ?? []).map((review) => ({
              id: Number(review.gh_pull_request_review_id),
              commit_id: review.commit_id,
              user: {
                id: Number(review.gh_user_id),
                login: review.gh_login,
              },
              body: review.body ?? "",
              state: normalizeReviewState(review.state),
              submitted_at: review.submitted_at
                ? new Date(review.submitted_at)
                : undefined,
              author_association: normalizeAuthorAssociation(
                review.author_association,
              ),
            })),
            commitList: (commitsByPrId.get(pullRequestId) ?? []).map(
              (commit) => ({
                commitSha: commit.sha,
                commitTitle: commit.message,
                user: {
                  id: Number(commit.gh_user_id),
                  login: commit.gh_login,
                },
                commitTime: new Date(commit.committed_at),
              }),
            ),
            files: [],
          },
        },
      });
    }

    return issues;
  }

  async insertPullRequestEnhancedStats(
    row: PullRequestEnhancedStatsInsertRow,
  ): Promise<"inserted" | "updated"> {
    return await this.sql.begin(async (sql) => {
      const result = await sql.unsafe(
        `
          INSERT INTO pull_request_enhanced_stats (
            pull_request_id,
            rounds_of_review,
            bot_rounds_of_review,
            first_review_at,
            first_approval_at,
            first_effective_approval_at,
            merged_after_post_approval_commit,
            ai_assisted_model
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (pull_request_id) DO UPDATE SET
            rounds_of_review = EXCLUDED.rounds_of_review,
            bot_rounds_of_review = EXCLUDED.bot_rounds_of_review,
            first_review_at = EXCLUDED.first_review_at,
            first_approval_at = EXCLUDED.first_approval_at,
            first_effective_approval_at = EXCLUDED.first_effective_approval_at,
            merged_after_post_approval_commit = EXCLUDED.merged_after_post_approval_commit,
            ai_assisted_model = EXCLUDED.ai_assisted_model
          RETURNING xmax = 0 AS inserted
        `,
        [
          row.pullRequestId,
          row.roundsOfReview,
          row.botRoundsOfReview,
          row.firstReviewAt,
          row.firstApprovalAt,
          row.firstEffectiveApprovalAt,
          row.mergedAfterPostApprovalCommit,
          row.aiAssistedModel,
        ],
      );

      await sql.unsafe(
        `
          INSERT INTO pull_request_round_of_review (pull_request_id, rounds)
          VALUES ($1, $2)
          ON CONFLICT (pull_request_id) DO UPDATE SET
            rounds = EXCLUDED.rounds
        `,
        [row.pullRequestId, row.roundsOfReview],
      );

      return result[0]?.inserted ? "inserted" : "updated";
    });
  }
}

function groupBy<T, TKey>(
  items: T[],
  keyFn: (item: T) => TKey,
): Map<TKey, T[]> {
  const grouped = new Map<TKey, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      grouped.set(key, [item]);
    }
  }
  return grouped;
}

function normalizeState(state: string): State {
  return state.toLowerCase() === State.OPEN ? State.OPEN : State.CLOSED;
}

function normalizeAuthorAssociation(value: string): AuthorAssociation {
  if (Object.values(AuthorAssociation).includes(value as AuthorAssociation)) {
    return value as AuthorAssociation;
  }
  return AuthorAssociation.NONE;
}

function normalizeReviewState(value: string): ReviewState {
  if (Object.values(ReviewState).includes(value as ReviewState)) {
    return value as ReviewState;
  }
  return ReviewState.COMMENTED;
}
