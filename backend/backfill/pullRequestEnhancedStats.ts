import { isGithubBot, type User } from "../models/gh/user.ts";
import { HydratedIssue } from "../models/gh/issue.ts";
import type { HydratedPullRequest } from "../models/gh/hydratedPullRequest.ts";
import { ReviewState } from "../models/gh/review.ts";
import {
  PullRequestEnhancedStats,
  PullRequestEnhancedStatsSchema,
} from "../../shared/models/pullRequestEnhancedStats.ts";
import { extractFirstAiAssistedModel } from "./aiAssistedModel.ts";

// Computes derived pull-request review timing stats from a hydrated PR.
//
// Current fields mean:
// - `roundsOfReview`: human-only inline PR review comment rounds. A round is
//   counted when at least one non-author human review comment lands and the
//   author later pushes a commit.
// - `botRoundsOfReview`: the same round concept, but only for windows where
//   bot inline PR review comments were present and no human inline review
//   comment was present before the author's next commit.
// - `firstReviewAt`: earliest non-author, non-bot review signal. We currently
//   treat PR review comments, issue-thread comments, and submitted formal
//   reviews as signals here.
// - `firstApprovalAt`: earliest non-author, non-bot APPROVED review.
// - `firstEffectiveApprovalAt`: earliest approval after the last commit by the
//   PR author when one exists. If the author pushes again after the latest
//   approval, we fall back to the earliest available approval so product
//   surfaces still have an approval timestamp to show.
// - `mergedAfterPostApprovalCommit`: true when the PR merged after at least one
//   approval, but the author pushed another commit after the latest approval.
//
// The legacy `reviewRounds.ts` implementation mixed bot and human inline review
// comments. Enhanced stats now classify rounds directly so the canonical field
// is human-only while still exposing bot-only rounds for diagnostics.
//
// One important nuance from real data: post-approval commits include meaningful
// fixes as well as sync/rebase-style commits like merging `main` into the
// branch. For review-round counting we currently ignore obvious branch-sync
// merge commits by title (`Merge branch ... into ...`) because they are usually
// not meaningful author responses to feedback. We also treat non-merge
// `web-flow` commits as author responses because GitHub web UI edits currently
// hydrate as `web-flow` in our commit model. Ideal future state: preserve both
// commit author and committer from GitHub so web UI author edits can still
// count while GitHub-generated sync merges do not.
//
// Round timing is selected for the whole PR: complete review linkage uses
// submitted_at and excludes pending feedback; incomplete/mixed linkage keeps
// created_at for every comment. This avoids splitting a draft review across
// author commits before its feedback was published. Other timing metrics,
// including firstReviewAt, retain their existing semantics.

function hasUser<T extends { user: User | null }>(
  value: T,
): value is T & { user: User } {
  return value.user !== null;
}

const isHumanReviewer = (prAuthorId: number, user: User): boolean => {
  return user.id !== prAuthorId && !isGithubBot(user);
};

export function computePullRequestEnhancedStats(
  issue: HydratedIssue,
): PullRequestEnhancedStats {
  if (issue.hydrated_pull_request === undefined) {
    return PullRequestEnhancedStatsSchema.parse({
      roundsOfReview: 0,
      botRoundsOfReview: 0,
      firstReviewAt: null,
      firstApprovalAt: null,
      firstEffectiveApprovalAt: null,
      mergedAfterPostApprovalCommit: false,
      aiAssistedModel: null,
    });
  }

  const pr = issue.hydrated_pull_request;
  const prAuthorId = pr.user.id;
  const roundCounts = computeRoundCounts(issue);

  const firstReviewCandidates = [
    ...pr.commentList
      .filter(hasUser)
      .filter((comment) => isHumanReviewer(prAuthorId, comment.user))
      .map((comment) => comment.created_at),
    ...pr.issueCommentList
      .filter(hasUser)
      .filter((comment) => isHumanReviewer(prAuthorId, comment.user))
      .map((comment) => comment.created_at),
    ...pr.reviews
      .filter((review) => {
        if (review.user === null) {
          return false;
        }
        if (review.submitted_at === undefined) {
          return false;
        }
        if (
          review.state === ReviewState.PENDING ||
          review.state === ReviewState.DISMISSED
        ) {
          return false;
        }
        return isHumanReviewer(prAuthorId, review.user);
      })
      .map((review) => review.submitted_at!),
  ];

  const firstApprovalCandidates = pr.reviews
    .filter((review) => {
      if (review.user === null) {
        return false;
      }
      if (review.submitted_at === undefined) {
        return false;
      }
      if (review.state !== ReviewState.APPROVED) {
        return false;
      }
      return isHumanReviewer(prAuthorId, review.user);
    })
    .map((review) => review.submitted_at!);

  const firstReviewAt = minDate(firstReviewCandidates);
  const firstApprovalAt = minDate(firstApprovalCandidates);
  const lastApprovalAt = maxDate(firstApprovalCandidates);
  const lastAuthorCommitAt = maxDate(
    pr.commitList
      .filter((commit) => commit.user.id === prAuthorId)
      .map((commit) => commit.commitTime),
  );
  const firstEffectiveApprovalAt = getFirstEffectiveApprovalAt(
    firstApprovalCandidates,
    pr.commitList
      .filter((commit) => commit.user.id === prAuthorId)
      .map((commit) => commit.commitTime),
  );
  const mergedAfterPostApprovalCommit =
    pr.merged_at !== null &&
    lastApprovalAt !== null &&
    lastAuthorCommitAt !== null &&
    lastAuthorCommitAt.getTime() > lastApprovalAt.getTime();
  const aiAssistedModel = extractFirstAiAssistedModel(
    pr.commitList.map((commit) => commit.commitTitle),
  );

  return PullRequestEnhancedStatsSchema.parse({
    roundsOfReview: roundCounts.humanRounds,
    botRoundsOfReview: roundCounts.botOnlyRounds,
    firstReviewAt,
    firstApprovalAt,
    firstEffectiveApprovalAt,
    mergedAfterPostApprovalCommit,
    aiAssistedModel,
  });
}

export enum ReviewTimingMode {
  REVIEW_LINKED = "review-linked",
  LEGACY = "legacy",
}

export function getReviewTimingMode(
  pr: Pick<HydratedPullRequest, "commentList" | "reviews">,
): ReviewTimingMode {
  if (pr.commentList.length === 0) {
    return ReviewTimingMode.LEGACY;
  }
  const reviewsById = new Map(pr.reviews.map((review) => [review.id, review]));
  const hasCompleteLinkage = pr.commentList.every((comment) => {
    if (comment.pull_request_review_id == null) return false;
    const review = reviewsById.get(comment.pull_request_review_id);
    if (!review) return false;
    return (
      review.state === ReviewState.PENDING ||
      (review.submitted_at instanceof Date &&
        Number.isFinite(review.submitted_at.getTime()))
    );
  });
  return hasCompleteLinkage
    ? ReviewTimingMode.REVIEW_LINKED
    : ReviewTimingMode.LEGACY;
}

function computeRoundCounts(issue: HydratedIssue): {
  humanRounds: number;
  botOnlyRounds: number;
} {
  if (issue.hydrated_pull_request === undefined) {
    return { humanRounds: 0, botOnlyRounds: 0 };
  }

  const pr = issue.hydrated_pull_request;
  const prAuthorId = pr.user.id;
  const timingMode = getReviewTimingMode(pr);
  const reviewsById = new Map(pr.reviews.map((review) => [review.id, review]));
  const events = [
    ...pr.commitList.map((commit) => ({
      type: "commit" as const,
      timestamp: commit.commitTime,
      userId: commit.user.id,
      login: commit.user.login,
      title: commit.commitTitle,
    })),
    ...pr.commentList.filter(hasUser).flatMap((comment) => {
      let timestamp = comment.created_at;
      if (timingMode === ReviewTimingMode.REVIEW_LINKED) {
        // Whole-PR classification guarantees the link and submitted timestamp.
        const review = reviewsById.get(comment.pull_request_review_id!)!;
        if (review.state === ReviewState.PENDING) return [];
        timestamp = review.submitted_at!;
      }
      return [
        {
          type: "comment" as const,
          timestamp,
          userId: comment.user.id,
          login: comment.user.login,
          isBot: isGithubBot(comment.user),
        },
      ];
    }),
  ].toSorted((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  let humanRounds = 0;
  let botOnlyRounds = 0;
  let sawHumanComment = false;
  let sawBotComment = false;

  for (const event of events) {
    if (event.type === "comment" && event.userId !== prAuthorId) {
      if (event.isBot) {
        sawBotComment = true;
      } else {
        sawHumanComment = true;
      }
      continue;
    }

    if (event.type === "commit" && closesReviewRound(event, prAuthorId)) {
      if (sawHumanComment) {
        humanRounds += 1;
      } else if (sawBotComment) {
        botOnlyRounds += 1;
      }
      sawHumanComment = false;
      sawBotComment = false;
    }
  }

  return { humanRounds, botOnlyRounds };
}

function isSyncMergeCommit(title: string): boolean {
  return title.includes("Merge branch") && title.includes("into");
}

function closesReviewRound(
  event: { userId: number; login: string; title: string },
  prAuthorId: number,
): boolean {
  if (isSyncMergeCommit(event.title)) {
    return false;
  }

  // Our hydrated commit model currently keeps the GitHub committer, not the
  // original commit author. GitHub web UI edits therefore show up as
  // `web-flow` even when the PR author made the change. For non-sync-merge
  // commits, treat `web-flow` as an author response until we preserve both
  // author and committer in the commit model.
  return event.userId === prAuthorId || event.login === "web-flow";
}

function getFirstEffectiveApprovalAt(
  approvalTimes: Date[],
  authorCommitTimes: Date[],
): Date | null {
  const lastAuthorCommitAt = minOrMaxDate(authorCommitTimes, "max");
  const sortedApprovals = approvalTimes.toSorted(
    (a, b) => a.getTime() - b.getTime(),
  );

  if (lastAuthorCommitAt === null) {
    return sortedApprovals[0] ?? null;
  }

  return (
    sortedApprovals.find(
      (approval) => approval.getTime() > lastAuthorCommitAt.getTime(),
    ) ??
    sortedApprovals[0] ??
    null
  );
}

function minDate(dates: Date[]): Date | null {
  return minOrMaxDate(dates, "min");
}

function maxDate(dates: Date[]): Date | null {
  return minOrMaxDate(dates, "max");
}

function minOrMaxDate(dates: Date[], direction: "min" | "max"): Date | null {
  if (dates.length === 0) {
    return null;
  }

  return dates.reduce((selected, current) => {
    if (direction === "min") {
      return current.getTime() < selected.getTime() ? current : selected;
    }
    return current.getTime() > selected.getTime() ? current : selected;
  });
}
