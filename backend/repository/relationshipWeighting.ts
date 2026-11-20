/**
 * Pure relationship-edge weighting logic.
 *
 * This module owns the formula that converts raw PR interaction events into
 * weighted edges for the relationship graph.  It is intentionally free of
 * database or I/O concerns so it can be unit-tested in isolation.
 *
 * ── Current formula ───────────────────────────────────────────────────
 *
 *   Per (reviewer → PR-author) pair we collect every review / comment
 *   event across all PRs in the time window, then score per PR:
 *
 *   Comments (inline + conversation + reviews-with-body):
 *     1 + log2(commentCount)          — diminishing returns on volume
 *
 *   Approvals:
 *     count × 1.5 (flat per approval)
 *
 *   Changes-requested:
 *     count × 2
 *
 *   Edge weight = round(sum of per-PR scores)
 *
 *   Dismissed reviews are dropped (no weight).
 *
 * ── Future enhancement opportunities ──────────────────────────────────
 *
 *   Rounds multiplier — apply a multiplier based on how many rounds of
 *   review the *specific reviewer* participated in on each PR.
 *   The PR-level `pull_request_round_of_review.rounds` value is NOT
 *   suitable because it measures total PR rounds, not per-reviewer
 *   participation.  A reviewer who arrives late on a 7-round PR should
 *   not get a 3.8x multiplier.  Correct implementation requires
 *   computing per-(reviewer, PR) rounds from the comment/commit
 *   timeline.  Data exists (`pull_request_comment.created_at`,
 *   `pull_request_commit.committed_at`, per user_id`) but the query
 *   is heavier than the current approach.
 *
 *   Approval splitting — distinguish rubber-stamp approvals from
 *   substantive ones.  Options explored:
 *     A) Review event has non-empty body → 2.5, else 0.75   (easy, data exists)
 *     B) Reviewer had prior comment/CR on this PR → 2.5     (timeline query)
 *     C) A ∨ B                                               (most accurate)
 *
 *   PR size coefficient — scale edge weight by PR complexity.
 *   Options explored:
 *     A) Line-count buckets (<100 ×1, 100-500 ×1.25, 500+ ×1.5)
 *     B) log formula: min(1 + log10(linesChanged / 100), 2)
 *     C) files-touched as complexity proxy (avoids rename noise)
 *     D) Skip — noisiest signal, needs validation first
 *
 *   All data for the above is already stored (pull_request.additions,
 *   deletions, changed_files; pull_request_review.body, submitted_at).
 */

import { z } from "zod";
import { type EdgeDataV1 } from "./userRelationshipRepository.ts";

// ── Input types (what the SQL query returns) ─────────────────────────

export const ReviewEventRowSchema = z.object({
  actor_id: z.coerce.number(),
  author_id: z.coerce.number(),
  pull_request_id: z.coerce.number(),
  state: z.string(),
  has_body: z.coerce.boolean(),
});
export type ReviewEventRow = z.infer<typeof ReviewEventRowSchema>;

export const CommentEventRowSchema = z.object({
  actor_id: z.coerce.number(),
  author_id: z.coerce.number(),
  pull_request_id: z.coerce.number(),
  comment_type: z.enum(["inline", "conversation"]),
});
export type CommentEventRow = z.infer<typeof CommentEventRowSchema>;

/** Everything the pure function needs — no DB handles, no side effects. */
export interface RawRelationshipEvents {
  reviews: ReviewEventRow[];
  comments: CommentEventRow[];
}

// ── Output type ──────────────────────────────────────────────────────

export interface ComputedEdge {
  actorId: number;
  targetId: number;
  edgeWeight: number;
  edgeData: EdgeDataV1;
}

// ── Internal accumulators ────────────────────────────────────────────

interface PairKey {
  actorId: number;
  targetId: number;
}

interface PrAccumulator {
  approvals: number;
  changesRequested: number;
  reviewsWithBody: number;
  inlineComments: number;
  convoComments: number;
}

function emptyPrAccumulator(): PrAccumulator {
  return {
    approvals: 0,
    changesRequested: 0,
    reviewsWithBody: 0,
    inlineComments: 0,
    convoComments: 0,
  };
}

function pairKey(actorId: number, targetId: number): string {
  return `${actorId}:${targetId}`;
}

// ── Pure computation ─────────────────────────────────────────────────

/**
 * Compute weighted relationship edges from raw PR interaction events.
 *
 * This is the single source of truth for the weighting formula.
 * It is a pure function: deterministic, no I/O, no side effects.
 */
export function computeRelationshipEdges(
  events: RawRelationshipEvents,
): ComputedEdge[] {
  // Accumulate per (actor, target, pull_request_id)
  const perPrMap = new Map<
    string,
    { pair: PairKey; prId: number; acc: PrAccumulator }
  >();

  function getPerPr(actorId: number, targetId: number, prId: number) {
    const key = `${actorId}:${targetId}:${prId}`;
    let entry = perPrMap.get(key);
    if (!entry) {
      entry = {
        pair: { actorId, targetId },
        prId,
        acc: emptyPrAccumulator(),
      };
      perPrMap.set(key, entry);
    }
    return entry;
  }

  // Classify review events
  for (const r of events.reviews) {
    if (r.state === "DISMISSED") continue; // dropped — no signal

    const entry = getPerPr(r.actor_id, r.author_id, r.pull_request_id);
    if (r.state === "APPROVED") {
      entry.acc.approvals += 1;
    } else if (r.state === "CHANGES_REQUESTED") {
      entry.acc.changesRequested += 1;
    }
    // A review with body (state = COMMENTED or any state) that has content
    if (r.has_body) {
      entry.acc.reviewsWithBody += 1;
    }
  }

  // Classify comment events
  for (const c of events.comments) {
    const entry = getPerPr(c.actor_id, c.author_id, c.pull_request_id);
    if (c.comment_type === "inline") {
      entry.acc.inlineComments += 1;
    } else {
      entry.acc.convoComments += 1;
    }
  }

  // Aggregate per (actor, target) across all PRs
  const pairMap = new Map<
    string,
    {
      pair: PairKey;
      prsContributed: Set<number>;
      totalApprovals: number;
      totalChangesRequested: number;
      totalReviewsWithBody: number;
      totalInlineComments: number;
      totalConvoComments: number;
      totalEvents: number;
      weightSum: number;
    }
  >();

  for (const { pair, prId, acc } of perPrMap.values()) {
    const key = pairKey(pair.actorId, pair.targetId);
    let agg = pairMap.get(key);
    if (!agg) {
      agg = {
        pair,
        prsContributed: new Set(),
        totalApprovals: 0,
        totalChangesRequested: 0,
        totalReviewsWithBody: 0,
        totalInlineComments: 0,
        totalConvoComments: 0,
        totalEvents: 0,
        weightSum: 0,
      };
      pairMap.set(key, agg);
    }

    agg.prsContributed.add(prId);
    agg.totalApprovals += acc.approvals;
    agg.totalChangesRequested += acc.changesRequested;
    agg.totalReviewsWithBody += acc.reviewsWithBody;
    agg.totalInlineComments += acc.inlineComments;
    agg.totalConvoComments += acc.convoComments;

    // Score this PR's contribution to the edge
    const prWeight = scorePrContribution(acc);
    agg.weightSum += prWeight;
    agg.totalEvents +=
      acc.approvals +
      acc.changesRequested +
      acc.reviewsWithBody +
      acc.inlineComments +
      acc.convoComments;
  }

  // Build output edges
  const edges: ComputedEdge[] = [];
  for (const agg of pairMap.values()) {
    // Round to integer for storage (matches existing column type)
    const edgeWeight = Math.round(agg.weightSum);
    if (edgeWeight <= 0) continue;

    edges.push({
      actorId: agg.pair.actorId,
      targetId: agg.pair.targetId,
      edgeWeight,
      edgeData: {
        v: 1,
        prs_touched: agg.prsContributed.size,
        total_events: agg.totalEvents,
        approvals: agg.totalApprovals,
        changes_requested: agg.totalChangesRequested,
        reviews_with_body: agg.totalReviewsWithBody,
        inline_comments: agg.totalInlineComments,
        convo_comments: agg.totalConvoComments,
        dismissed: 0, // dropped — kept in schema for compat
      },
    });
  }

  return edges;
}

// ── Scoring helpers ──────────────────────────────────────────────────

/**
 * Score a single PR's contribution to an edge between (reviewer, author).
 *
 * Formula:
 *   commentScore = commentCount > 0 ? 1 + log2(commentCount) : 0
 *   approvalScore = approvals × 1.5
 *   crScore = changesRequested × 2
 *   prScore = commentScore + approvalScore + crScore
 */
function scorePrContribution(acc: PrAccumulator): number {
  const commentCount =
    acc.reviewsWithBody + acc.inlineComments + acc.convoComments;

  const commentScore = commentCount > 0 ? 1 + Math.log2(commentCount) : 0;
  const approvalScore = acc.approvals * 1.5;
  const crScore = acc.changesRequested * 2;

  return commentScore + approvalScore + crScore;
}

// Export for testing
export { scorePrContribution };
