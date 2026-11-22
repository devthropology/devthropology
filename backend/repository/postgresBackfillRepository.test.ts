import { afterAll, beforeAll, describe, it } from "vitest";
import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { createSqlClient, SqlClient } from "./sqlClient.ts";
import { PostgresRepository } from "./postgresRepository.ts";
import { PostgresBackfillRepository } from "./postgresBackfillRepository.ts";
import { HydratedIssue } from "../models/gh/issue.ts";
import { State } from "../models/gh/state.ts";
import { IssueType } from "../models/gh/issueType.ts";
import { AuthorAssociation } from "../models/gh/authorAssociation.ts";
import { ReviewState } from "../models/gh/review.ts";
import { getCleanTestDatabase } from "../testUtils/testDatabase.ts";

describe("PostgresBackfillRepository", () => {
  let sql: SqlClient;

  beforeAll(async () => {
    sql = createSqlClient(await getCleanTestDatabase());
  });

  afterAll(async () => {
    await sql?.end({ timeout: 1 });
  });

  it("hydrates PR batches and keeps review-round tables consistent on insert and update", async () => {
    const repo = new PostgresRepository("bf-org", "bf-repo", sql);
    const backfillRepo = new PostgresBackfillRepository(sql);

    const testPr: HydratedIssue = {
      number: 42,
      title: "Backfill PR",
      body: "body",
      state: State.CLOSED,
      created_at: new Date("2024-01-01T00:00:00Z"),
      updated_at: new Date("2024-01-02T00:00:00Z"),
      closed_at: new Date("2024-01-02T00:00:00Z"),
      user: { id: 100, login: "author" },
      type: IssueType.PULL_REQUEST,
      hydrated_pull_request: {
        number: 42,
        title: "Backfill PR",
        body: "body",
        state: State.CLOSED,
        created_at: new Date("2024-01-01T00:00:00Z"),
        updated_at: new Date("2024-01-02T00:00:00Z"),
        closed_at: new Date("2024-01-02T00:00:00Z"),
        merged_at: new Date("2024-01-02T00:00:00Z"),
        merge_commit_sha: "merge-sha",
        user: { id: 100, login: "author" },
        sourceBranch: "feature",
        targetBranch: "main",
        comments: 1,
        review_comments: 1,
        commits: 2,
        additions: 10,
        deletions: 4,
        changed_files: 2,
        reviews: [
          {
            id: 900,
            commit_id: "reviewed-sha",
            user: { id: 200, login: "reviewer", type: "Bot" },
            body: "looks good",
            state: ReviewState.APPROVED,
            submitted_at: new Date("2024-01-01T03:00:00Z"),
            author_association: AuthorAssociation.MEMBER,
          },
        ],
        commentList: [
          {
            id: 901,
            pull_request_review_id: 900,
            in_reply_to_id: 899,
            line: null,
            original_line: 12,
            reactions: {
              "+1": 2,
              "-1": 0,
              laugh: 0,
              hooray: 0,
              confused: 0,
              heart: 1,
              rocket: 0,
              eyes: 0,
            },
            path: "mod.ts",
            body: "inline",
            user: { id: 200, login: "reviewer", type: "Bot" },
            created_at: new Date("2024-01-01T01:00:00Z"),
            updated_at: new Date("2024-01-01T01:00:00Z"),
            author_association: AuthorAssociation.MEMBER,
          },
        ],
        issueCommentList: [
          {
            id: 902,
            body: "thread",
            user: { id: 200, login: "reviewer", type: "Bot" },
            created_at: new Date("2024-01-01T02:00:00Z"),
            updated_at: new Date("2024-01-01T02:00:00Z"),
            author_association: AuthorAssociation.MEMBER,
          },
        ],
        commitList: [
          {
            commitSha: "sha-1",
            commitTitle: "initial",
            user: { id: 100, login: "author" },
            commitTime: new Date("2024-01-01T00:30:00Z"),
          },
          {
            commitSha: "sha-2",
            commitTitle: "follow-up",
            user: { id: 100, login: "author" },
            commitTime: new Date("2024-01-01T04:00:00Z"),
          },
        ],
        files: [],
      },
    };

    await repo.insertIssue(testPr, {
      roundsOfReview: 1,
      botRoundsOfReview: 0,
      firstReviewAt: new Date("2024-01-01T01:00:00Z"),
      firstApprovalAt: new Date("2024-01-01T03:00:00Z"),
      firstEffectiveApprovalAt: null,
      mergedAfterPostApprovalCommit: true,
      aiAssistedModel: "Claude Sonnet 4.5",
    });

    const repositoryId = await backfillRepo.getRepositoryId(
      "bf-org",
      "bf-repo",
    );
    const batch = await backfillRepo.getClosedPullRequestBatch(
      repositoryId,
      100,
      0,
    );
    assertEquals(batch.length, 1);
    assertEquals(batch[0].ghIssueNumber, 42);

    const hydrated =
      await backfillRepo.getHydratedIssuesForEnhancedStatsBackfill(
        repositoryId,
        [42],
      );
    const issue = hydrated.get(42);
    assertEquals(issue?.pullRequestId, batch[0].pullRequestId);
    assertEquals(issue?.issue.hydrated_pull_request?.commentList.length, 1);
    assertEquals(
      issue?.issue.hydrated_pull_request?.issueCommentList.length,
      1,
    );
    assertEquals(issue?.issue.hydrated_pull_request?.reviews.length, 1);
    assertEquals(issue?.issue.hydrated_pull_request?.commitList.length, 2);
    const comment = issue?.issue.hydrated_pull_request?.commentList[0];
    assertEquals(comment?.pull_request_review_id, 900);
    assertEquals(comment?.user?.type, "Bot");
    assertEquals(
      issue?.issue.hydrated_pull_request?.reviews[0].user?.type,
      "Bot",
    );
    // Missing parent comments do not block ingestion.
    assertEquals(comment?.in_reply_to_id, 899);
    assertEquals(comment?.line, null);
    assertEquals(comment?.original_line, 12);
    assertEquals(
      comment?.reactions,
      testPr.hydrated_pull_request?.commentList[0].reactions,
    );
    assertEquals(comment?.reactions_observed_at instanceof Date, true);
    assertEquals(
      issue?.issue.hydrated_pull_request?.reviews[0].commit_id,
      "reviewed-sha",
    );

    await sql.unsafe(
      "DELETE FROM pull_request_enhanced_stats WHERE pull_request_id = $1",
      [batch[0].pullRequestId],
    );

    await sql.unsafe(
      "DELETE FROM pull_request_round_of_review WHERE pull_request_id = $1",
      [batch[0].pullRequestId],
    );

    const assertRoundCounts = async (expected: number) => {
      const rows = await sql.unsafe(
        `SELECT pres.rounds_of_review, prrr.rounds
         FROM pull_request_enhanced_stats pres
         JOIN pull_request_round_of_review prrr USING (pull_request_id)
         WHERE pres.pull_request_id = $1`,
        [batch[0].pullRequestId],
      );
      assertEquals(rows.length, 1);
      assertEquals(Number(rows[0].rounds_of_review), expected);
      assertEquals(Number(rows[0].rounds), expected);
    };

    const inserted = await backfillRepo.insertPullRequestEnhancedStats({
      pullRequestId: batch[0].pullRequestId,
      roundsOfReview: 1,
      botRoundsOfReview: 0,
      firstReviewAt: new Date("2024-01-01T01:00:00Z"),
      firstApprovalAt: new Date("2024-01-01T03:00:00Z"),
      firstEffectiveApprovalAt: null,
      mergedAfterPostApprovalCommit: true,
      aiAssistedModel: "Claude Sonnet 4.5",
    });
    assertEquals(inserted, "inserted");
    await assertRoundCounts(1);

    // Simulate a stale legacy count before recalculation.
    await sql.unsafe(
      "UPDATE pull_request_round_of_review SET rounds = 6 WHERE pull_request_id = $1",
      [batch[0].pullRequestId],
    );
    const updated = await backfillRepo.insertPullRequestEnhancedStats({
      pullRequestId: batch[0].pullRequestId,
      roundsOfReview: 3,
      botRoundsOfReview: 2,
      firstReviewAt: new Date("2024-01-01T01:00:00Z"),
      firstApprovalAt: new Date("2024-01-01T03:00:00Z"),
      firstEffectiveApprovalAt: null,
      mergedAfterPostApprovalCommit: true,
      aiAssistedModel: "Claude Sonnet 4.5",
    });

    assertEquals(updated, "updated");
    await assertRoundCounts(3);

    const enhancedStatsRows = await sql.unsafe(
      "SELECT ai_assisted_model FROM pull_request_enhanced_stats WHERE pull_request_id = $1",
      [batch[0].pullRequestId],
    );
    assertEquals(enhancedStatsRows[0].ai_assisted_model, "Claude Sonnet 4.5");

    await repo.close();
  });
});
