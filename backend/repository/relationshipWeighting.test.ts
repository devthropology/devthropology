import { test } from "vitest";
import { deepStrictEqual as assertEquals } from "node:assert/strict";
import {
  computeRelationshipEdges,
  scorePrContribution,
} from "./relationshipWeighting.ts";

// ── scorePrContribution ──────────────────────────────────────────────

test("scorePrContribution: single approval, no comments", () => {
  const score = scorePrContribution({
    approvals: 1,
    changesRequested: 0,
    reviewsWithBody: 0,
    inlineComments: 0,
    convoComments: 0,
  });
  assertEquals(score, 1.5);
});

test("scorePrContribution: single changes-requested", () => {
  const score = scorePrContribution({
    approvals: 0,
    changesRequested: 1,
    reviewsWithBody: 0,
    inlineComments: 0,
    convoComments: 0,
  });
  assertEquals(score, 2);
});

test("scorePrContribution: one inline comment", () => {
  const score = scorePrContribution({
    approvals: 0,
    changesRequested: 0,
    reviewsWithBody: 0,
    inlineComments: 1,
    convoComments: 0,
  });
  // 1 + log2(1) = 1 + 0 = 1
  assertEquals(score, 1);
});

test("scorePrContribution: 4 comments uses log2 diminishing returns", () => {
  const score = scorePrContribution({
    approvals: 0,
    changesRequested: 0,
    reviewsWithBody: 0,
    inlineComments: 4,
    convoComments: 0,
  });
  // 1 + log2(4) = 1 + 2 = 3
  assertEquals(score, 3);
});

test("scorePrContribution: mixed comments sum before log", () => {
  const score = scorePrContribution({
    approvals: 0,
    changesRequested: 0,
    reviewsWithBody: 1,
    inlineComments: 2,
    convoComments: 1,
  });
  // commentCount = 4, 1 + log2(4) = 3
  assertEquals(score, 3);
});

test("scorePrContribution: comments + approval", () => {
  const score = scorePrContribution({
    approvals: 1,
    changesRequested: 0,
    reviewsWithBody: 0,
    inlineComments: 2,
    convoComments: 0,
  });
  // commentScore = 1 + log2(2) = 2
  // approvalScore = 1.5
  // 2 + 1.5 = 3.5
  assertEquals(score, 3.5);
});

test("scorePrContribution: no activity scores zero", () => {
  const score = scorePrContribution({
    approvals: 0,
    changesRequested: 0,
    reviewsWithBody: 0,
    inlineComments: 0,
    convoComments: 0,
  });
  assertEquals(score, 0);
});

// ── computeRelationshipEdges ─────────────────────────────────────────

test("computeRelationshipEdges: empty input returns empty", () => {
  const edges = computeRelationshipEdges({
    reviews: [],
    comments: [],
  });
  assertEquals(edges, []);
});

test("computeRelationshipEdges: single approval on one PR", () => {
  const edges = computeRelationshipEdges({
    reviews: [
      {
        actor_id: 10,
        author_id: 20,
        pull_request_id: 1,
        state: "APPROVED",
        has_body: false,
      },
    ],
    comments: [],
  });
  assertEquals(edges.length, 1);
  assertEquals(edges[0].actorId, 10);
  assertEquals(edges[0].targetId, 20);
  assertEquals(edges[0].edgeWeight, 2); // round(1.5) = 2
  assertEquals(edges[0].edgeData.approvals, 1);
  assertEquals(edges[0].edgeData.prs_touched, 1);
  assertEquals(edges[0].edgeData.dismissed, 0);
});

test("computeRelationshipEdges: dismissed reviews are ignored", () => {
  const edges = computeRelationshipEdges({
    reviews: [
      {
        actor_id: 10,
        author_id: 20,
        pull_request_id: 1,
        state: "DISMISSED",
        has_body: false,
      },
    ],
    comments: [],
  });
  assertEquals(edges, []);
});

test("computeRelationshipEdges: events across two PRs aggregate", () => {
  const edges = computeRelationshipEdges({
    reviews: [
      {
        actor_id: 10,
        author_id: 20,
        pull_request_id: 1,
        state: "APPROVED",
        has_body: false,
      },
      {
        actor_id: 10,
        author_id: 20,
        pull_request_id: 2,
        state: "APPROVED",
        has_body: false,
      },
    ],
    comments: [],
  });
  assertEquals(edges.length, 1);
  // Two PRs, each 1.5, sum = 3, round(3) = 3
  assertEquals(edges[0].edgeWeight, 3);
  assertEquals(edges[0].edgeData.prs_touched, 2);
  assertEquals(edges[0].edgeData.approvals, 2);
});

test("computeRelationshipEdges: separate pairs stay separate", () => {
  const edges = computeRelationshipEdges({
    reviews: [
      {
        actor_id: 10,
        author_id: 20,
        pull_request_id: 1,
        state: "APPROVED",
        has_body: false,
      },
      {
        actor_id: 30,
        author_id: 20,
        pull_request_id: 1,
        state: "APPROVED",
        has_body: false,
      },
    ],
    comments: [],
  });
  assertEquals(edges.length, 2);
  const actors = edges.map((e) => e.actorId).sort();
  assertEquals(actors, [10, 30]);
});

test("computeRelationshipEdges: review with body counts as comment", () => {
  const edges = computeRelationshipEdges({
    reviews: [
      {
        actor_id: 10,
        author_id: 20,
        pull_request_id: 1,
        state: "COMMENTED",
        has_body: true,
      },
    ],
    comments: [],
  });
  assertEquals(edges.length, 1);
  // commentScore = 1 + log2(1) = 1
  assertEquals(edges[0].edgeWeight, 1);
  assertEquals(edges[0].edgeData.reviews_with_body, 1);
});

test("computeRelationshipEdges: edgeData tracks all counts", () => {
  const edges = computeRelationshipEdges({
    reviews: [
      {
        actor_id: 10,
        author_id: 20,
        pull_request_id: 1,
        state: "APPROVED",
        has_body: true,
      },
      {
        actor_id: 10,
        author_id: 20,
        pull_request_id: 1,
        state: "CHANGES_REQUESTED",
        has_body: false,
      },
    ],
    comments: [
      {
        actor_id: 10,
        author_id: 20,
        pull_request_id: 1,
        comment_type: "inline",
      },
      {
        actor_id: 10,
        author_id: 20,
        pull_request_id: 1,
        comment_type: "inline",
      },
      {
        actor_id: 10,
        author_id: 20,
        pull_request_id: 1,
        comment_type: "conversation",
      },
    ],
  });
  assertEquals(edges.length, 1);
  const d = edges[0].edgeData;
  assertEquals(d.approvals, 1);
  assertEquals(d.changes_requested, 1);
  assertEquals(d.reviews_with_body, 1);
  assertEquals(d.inline_comments, 2);
  assertEquals(d.convo_comments, 1);
  assertEquals(d.dismissed, 0);
  assertEquals(d.prs_touched, 1);
  // total_events = 1 + 1 + 1 + 2 + 1 = 6
  assertEquals(d.total_events, 6);
  // commentScore = 1 + log2(4) = 3, approval = 1.5, cr = 2, total = 6.5
  assertEquals(edges[0].edgeWeight, 7); // round(6.5)
});
