import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { GhApi } from "../api/ghApi.ts";
import { computePullRequestEnhancedStats } from "../backfill/pullRequestEnhancedStats.ts";
import { GhCommentSchema } from "../models/gh/comment.ts";
import { ReviewSchema } from "../models/gh/review.ts";
import {
  mockFetch,
  type JsonValue,
  type MockUrls,
} from "../test/mock_fetch.ts";
import { getCleanTestDatabase } from "../testUtils/testDatabase.ts";
import { PostgresRepository } from "./postgresRepository.ts";
import { PostgresBackfillRepository } from "./postgresBackfillRepository.ts";
import { createSqlClient, type SqlClient } from "./sqlClient.ts";

type RecordedResponse = {
  endpoint: string;
  response: JsonValue;
  status: number;
};

// PR #357: two roots in one review, a reply in another, and real nonzero reactions.
const fixturePrNumber = 357;
async function loadThreadFixture() {
  const lines = (await readFile("tailscale.jsonl", "utf8"))
    .split("\n")
    .filter(Boolean);
  const entries = lines.flatMap((line) => {
    const record = JSON.parse(line) as Record<string, RecordedResponse[]>;
    return record[fixturePrNumber] ?? [];
  });
  expect(entries.length).toBeGreaterThan(0);
  const urls: MockUrls = {};
  for (const entry of entries) {
    urls[entry.endpoint] = { body: entry.response, status: entry.status };
  }
  mockFetch(urls);
  const comments = entries.find((entry) =>
    entry.endpoint.includes(`/pulls/${fixturePrNumber}/comments?`),
  )!.response as Record<string, JsonValue>[];
  const reviews = entries.find((entry) =>
    entry.endpoint.includes(`/pulls/${fixturePrNumber}/reviews?`),
  )!.response as Record<string, JsonValue>[];
  return { comments, reviews };
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("review comment context plumbing", () => {
  let sql: SqlClient;
  beforeAll(async () => {
    sql = createSqlClient(await getCleanTestDatabase());
  });
  afterAll(async () => {
    await sql?.end({ timeout: 1 });
  });

  it("preserves real threads, shared reviews and reactions through parsing, SQL insertion and reload", async () => {
    const raw = await loadThreadFixture();
    const api = new GhApi("tailscale", "tailscale", "test", "test");
    const issue = await api.getFullIssue(fixturePrNumber);
    const recorded = api
      .getEndpointResponses()
      [fixturePrNumber].find((entry) =>
        entry.endpoint.includes(`/pulls/${fixturePrNumber}/comments?`),
      );
    expect(recorded!.response).toEqual(raw.comments);
    const repo = new PostgresRepository("tailscale", "tailscale", sql);
    const beforeInsert = Date.now();
    await repo.insertIssue(issue, computePullRequestEnhancedStats(issue));
    const afterInsert = Date.now();

    const backfillRepo = new PostgresBackfillRepository(sql);
    const repoId = await backfillRepo.getRepositoryId("tailscale", "tailscale");
    const hydrated =
      await backfillRepo.getHydratedIssuesForEnhancedStatsBackfill(repoId, [
        fixturePrNumber,
      ]);
    const result = hydrated.get(fixturePrNumber)!;
    const pr = result.issue.hydrated_pull_request!;
    const rows = await sql.unsafe(
      "SELECT * FROM pull_request_comment WHERE pull_request_id = $1 ORDER BY created_at, gh_pull_request_comment_id",
      [result.pullRequestId],
    );
    expect(rows).toHaveLength(3);
    for (const source of raw.comments) {
      const parsed = GhCommentSchema.parse(source);
      const row = rows.find(
        (row) => Number(row.gh_pull_request_comment_id) === source.id,
      )!;
      expect(Number(row.gh_pull_request_review_id)).toBe(
        source.pull_request_review_id,
      );
      expect(
        row.gh_in_reply_to_comment_id == null
          ? null
          : Number(row.gh_in_reply_to_comment_id),
      ).toBe(source.in_reply_to_id ?? null);
      for (const field of [
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
      ] as const) {
        expect(row[field]).toEqual(source[field] ?? null);
      }
      expect(row.reactions).toEqual(parsed.reactions);
      expect(row.reactions_observed_at).toBeInstanceOf(Date);
      expect(row.reactions_observed_at.getTime()).toBeGreaterThanOrEqual(
        beforeInsert,
      );
      expect(row.reactions_observed_at.getTime()).toBeLessThanOrEqual(
        afterInsert,
      );
      expect(
        pr.commentList.find((comment) => comment.id === source.id),
      ).toEqual({
        ...parsed,
        in_reply_to_id: parsed.in_reply_to_id ?? null,
        reactions_observed_at: row.reactions_observed_at,
      });
    }
    for (const source of raw.reviews) {
      expect(pr.reviews.find((review) => review.id === source.id)).toEqual(
        ReviewSchema.parse(source),
      );
    }
    expect(
      pr.commentList.map((comment) => ({
        id: comment.id,
        review: comment.pull_request_review_id,
        replyTo: comment.in_reply_to_id,
        thumbsUp: comment.reactions?.["+1"],
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "id": 421460154,
          "replyTo": null,
          "review": 407415940,
          "thumbsUp": 1,
        },
        {
          "id": 421461046,
          "replyTo": null,
          "review": 407415940,
          "thumbsUp": 1,
        },
        {
          "id": 421564321,
          "replyTo": 421460154,
          "review": 407548161,
          "thumbsUp": 0,
        },
      ]
    `);
  });
});
