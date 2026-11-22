import { test } from "vitest";
import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { AuthorAssociation } from "../../models/gh/authorAssociation.ts";
import { IssueType } from "../../models/gh/issueType.ts";
import { ReviewState } from "../../models/gh/review.ts";
import { State } from "../../models/gh/state.ts";
import { HydratedIssue } from "../../models/gh/issue.ts";
import {
  computePullRequestEnhancedStats,
  getReviewTimingMode,
  ReviewTimingMode,
} from "../../backfill/pullRequestEnhancedStats.ts";

function buildPullRequestIssue(
  overrides: Partial<HydratedIssue> = {},
): HydratedIssue {
  return {
    number: 1,
    title: "Test PR",
    body: "body",
    state: State.CLOSED,
    created_at: new Date("2023-05-21T08:00:00Z"),
    updated_at: new Date("2023-05-21T12:00:00Z"),
    closed_at: new Date("2023-05-21T12:00:00Z"),
    user: { id: 1, login: "author" },
    type: IssueType.PULL_REQUEST,
    hydrated_pull_request: {
      number: 1,
      title: "Test PR",
      body: "body",
      state: State.CLOSED,
      created_at: new Date("2023-05-21T08:00:00Z"),
      updated_at: new Date("2023-05-21T12:00:00Z"),
      closed_at: new Date("2023-05-21T12:00:00Z"),
      merged_at: new Date("2023-05-21T12:00:00Z"),
      merge_commit_sha: "abc123",
      user: { id: 1, login: "author" },
      sourceBranch: "feature",
      targetBranch: "main",
      comments: 0,
      review_comments: 0,
      commits: 1,
      additions: 10,
      deletions: 2,
      changed_files: 1,
      reviews: [],
      commentList: [],
      issueCommentList: [],
      commitList: [
        {
          commitSha: "abc123",
          commitTitle: "initial",
          user: { id: 1, login: "author" },
          commitTime: new Date("2023-05-21T08:30:00Z"),
        },
      ],
      files: [],
    },
    ...overrides,
  };
}

test.each([
  {
    scenario: "complete linkage",
    mode: ReviewTimingMode.REVIEW_LINKED,
    rounds: 1,
  },
  {
    scenario: "missing one review ID",
    mode: ReviewTimingMode.LEGACY,
    rounds: 2,
  },
  {
    scenario: "unresolved review ID",
    mode: ReviewTimingMode.LEGACY,
    rounds: 2,
  },
  {
    scenario: "missing submission time",
    mode: ReviewTimingMode.LEGACY,
    rounds: 2,
  },
  {
    scenario: "invalid submission time",
    mode: ReviewTimingMode.LEGACY,
    rounds: 2,
  },
  { scenario: "no review IDs", mode: ReviewTimingMode.LEGACY, rounds: 2 },
  {
    scenario: "pending review",
    mode: ReviewTimingMode.REVIEW_LINKED,
    rounds: 0,
  },
  {
    scenario: "dismissed review",
    mode: ReviewTimingMode.REVIEW_LINKED,
    rounds: 1,
  },
  { scenario: "no comments", mode: ReviewTimingMode.LEGACY, rounds: 0 },
])("selects whole-PR timing for $scenario", ({ scenario, mode, rounds }) => {
  const issue = buildPullRequestIssue();
  const pr = issue.hydrated_pull_request!;
  const reviewer = { id: 2, login: "reviewer" };
  pr.commentList = ["09:00", "10:00"].map((time, index) => ({
    id: 100 + index,
    pull_request_review_id: 200,
    path: "example.ts",
    body: "draft feedback",
    user: reviewer,
    created_at: new Date(`2023-05-21T${time}:00Z`),
    updated_at: new Date(`2023-05-21T${time}:00Z`),
    author_association: AuthorAssociation.MEMBER,
  }));
  pr.reviews = [
    {
      id: 200,
      body: "submitted together",
      user: reviewer,
      state: ReviewState.COMMENTED,
      submitted_at: new Date("2023-05-21T11:00:00Z"),
      author_association: AuthorAssociation.MEMBER,
    },
  ];
  pr.commitList = ["09:30", "11:30"].map((time, index) => ({
    commitSha: `commit-${index}`,
    commitTitle: "author changes",
    user: pr.user,
    commitTime: new Date(`2023-05-21T${time}:00Z`),
  }));
  switch (scenario) {
    case "missing one review ID":
      pr.commentList[1].pull_request_review_id = null;
      break;
    case "unresolved review ID":
      pr.commentList[1].pull_request_review_id = 999;
      break;
    case "missing submission time":
      pr.reviews[0].submitted_at = undefined;
      break;
    case "invalid submission time":
      pr.reviews[0].submitted_at = new Date("invalid");
      break;
    case "no review IDs":
      pr.commentList.forEach((comment) => {
        delete comment.pull_request_review_id;
      });
      break;
    case "pending review":
      pr.reviews[0].state = ReviewState.PENDING;
      pr.reviews[0].submitted_at = undefined;
      break;
    case "dismissed review":
      pr.reviews[0].state = ReviewState.DISMISSED;
      break;
    case "no comments":
      pr.commentList = [];
      break;
  }
  assertEquals(getReviewTimingMode(pr), mode);
  const stats = computePullRequestEnhancedStats(issue);
  assertEquals(stats.roundsOfReview, rounds);
  assertEquals(stats.botRoundsOfReview, 0);
});

test("computes first review from earliest non-author feedback", () => {
  const issue = buildPullRequestIssue({
    hydrated_pull_request: {
      ...buildPullRequestIssue().hydrated_pull_request!,
      issueCommentList: [
        {
          id: 10,
          body: "first issue comment",
          user: { id: 2, login: "reviewer" },
          created_at: new Date("2023-05-21T08:45:00Z"),
          updated_at: new Date("2023-05-21T08:45:00Z"),
          author_association: AuthorAssociation.MEMBER,
        },
      ],
      commentList: [
        {
          id: 11,
          path: "mod.ts",
          body: "inline comment",
          user: { id: 3, login: "reviewer-two" },
          created_at: new Date("2023-05-21T09:00:00Z"),
          updated_at: new Date("2023-05-21T09:00:00Z"),
          author_association: AuthorAssociation.MEMBER,
        },
      ],
      reviews: [
        {
          id: 12,
          body: "looks good",
          user: { id: 4, login: "reviewer-three" },
          state: ReviewState.APPROVED,
          submitted_at: new Date("2023-05-21T09:15:00Z"),
          author_association: AuthorAssociation.MEMBER,
        },
      ],
    },
  });

  const stats = computePullRequestEnhancedStats(issue);

  assertEquals(stats.firstReviewAt?.toISOString(), "2023-05-21T08:45:00.000Z");
  assertEquals(
    stats.firstApprovalAt?.toISOString(),
    "2023-05-21T09:15:00.000Z",
  );
  assertEquals(
    stats.firstEffectiveApprovalAt?.toISOString(),
    "2023-05-21T09:15:00.000Z",
  );
  assertEquals(stats.roundsOfReview, 0);
  assertEquals(stats.botRoundsOfReview, 0);
  assertEquals(stats.mergedAfterPostApprovalCommit, false);
  assertEquals(stats.aiAssistedModel, null);
});

test("extracts first AI-assisted model from commit co-author trailers", () => {
  const issue = buildPullRequestIssue({
    hydrated_pull_request: {
      ...buildPullRequestIssue().hydrated_pull_request!,
      commitList: [
        {
          commitSha: "abc123",
          commitTitle:
            "feat: add thing\n\nCo-authored-by: Claude Sonnet 4.5 <noreply@anthropic.com>",
          user: { id: 1, login: "author" },
          commitTime: new Date("2023-05-21T08:30:00Z"),
        },
        {
          commitSha: "def456",
          commitTitle:
            "follow-up\n\nCo-authored-by: Claude Opus 4.6 <noreply@anthropic.com>",
          user: { id: 1, login: "author" },
          commitTime: new Date("2023-05-21T09:30:00Z"),
        },
      ],
    },
  });

  const stats = computePullRequestEnhancedStats(issue);

  assertEquals(stats.aiAssistedModel, "Claude Sonnet 4.5");
});

test("ignores author and bot events for first review and approval", () => {
  const issue = buildPullRequestIssue({
    hydrated_pull_request: {
      ...buildPullRequestIssue().hydrated_pull_request!,
      issueCommentList: [
        {
          id: 10,
          body: "self comment",
          user: { id: 1, login: "author" },
          created_at: new Date("2023-05-21T08:45:00Z"),
          updated_at: new Date("2023-05-21T08:45:00Z"),
          author_association: AuthorAssociation.OWNER,
        },
      ],
      commentList: [
        {
          id: 11,
          path: "mod.ts",
          body: "bot note",
          user: { id: 2, login: "dependabot[bot]" },
          created_at: new Date("2023-05-21T09:00:00Z"),
          updated_at: new Date("2023-05-21T09:00:00Z"),
          author_association: AuthorAssociation.NONE,
        },
      ],
      reviews: [
        {
          id: 12,
          body: "ship it",
          user: { id: 3, login: "human-reviewer" },
          state: ReviewState.APPROVED,
          submitted_at: new Date("2023-05-21T09:15:00Z"),
          author_association: AuthorAssociation.MEMBER,
        },
      ],
    },
  });

  const stats = computePullRequestEnhancedStats(issue);

  assertEquals(stats.firstReviewAt?.toISOString(), "2023-05-21T09:15:00.000Z");
  assertEquals(
    stats.firstApprovalAt?.toISOString(),
    "2023-05-21T09:15:00.000Z",
  );
  assertEquals(
    stats.firstEffectiveApprovalAt?.toISOString(),
    "2023-05-21T09:15:00.000Z",
  );
  assertEquals(stats.roundsOfReview, 0);
  assertEquals(stats.botRoundsOfReview, 0);
  assertEquals(stats.mergedAfterPostApprovalCommit, false);
});

test("preserves existing rounds of review behavior", () => {
  const issue = buildPullRequestIssue({
    hydrated_pull_request: {
      ...buildPullRequestIssue().hydrated_pull_request!,
      commentList: [
        {
          id: 11,
          path: "mod.ts",
          body: "needs update",
          user: { id: 2, login: "reviewer" },
          created_at: new Date("2023-05-21T09:00:00Z"),
          updated_at: new Date("2023-05-21T09:00:00Z"),
          author_association: AuthorAssociation.MEMBER,
        },
      ],
      commitList: [
        {
          commitSha: "abc123",
          commitTitle: "initial",
          user: { id: 1, login: "author" },
          commitTime: new Date("2023-05-21T08:30:00Z"),
        },
        {
          commitSha: "def456",
          commitTitle: "follow-up",
          user: { id: 1, login: "author" },
          commitTime: new Date("2023-05-21T09:30:00Z"),
        },
      ],
    },
  });

  const stats = computePullRequestEnhancedStats(issue);

  assertEquals(stats.roundsOfReview, 1);
  assertEquals(stats.botRoundsOfReview, 0);
});

test("formal approval with a review body does not count as a round without inline review comments", () => {
  const base = buildPullRequestIssue().hydrated_pull_request!;
  const issue = buildPullRequestIssue({
    hydrated_pull_request: {
      ...base,
      reviews: [
        {
          id: 14,
          body: "approved with context in the review body",
          user: { id: 2, login: "reviewer-one" },
          state: ReviewState.APPROVED,
          submitted_at: new Date("2023-05-21T09:00:00Z"),
          author_association: AuthorAssociation.MEMBER,
        },
      ],
      commitList: [
        {
          commitSha: "abc123",
          commitTitle: "initial",
          user: { id: 1, login: "author" },
          commitTime: new Date("2023-05-21T08:30:00Z"),
        },
        {
          commitSha: "def456",
          commitTitle: "follow-up after approval",
          user: { id: 1, login: "author" },
          commitTime: new Date("2023-05-21T09:30:00Z"),
        },
      ],
      commentList: [],
      issueCommentList: [],
    },
  });

  const stats = computePullRequestEnhancedStats(issue);

  assertEquals(stats.roundsOfReview, 0);
  assertEquals(stats.botRoundsOfReview, 0);
  assertEquals(
    stats.firstApprovalAt?.toISOString(),
    "2023-05-21T09:00:00.000Z",
  );
  assertEquals(
    stats.firstEffectiveApprovalAt?.toISOString(),
    "2023-05-21T09:00:00.000Z",
  );
  assertEquals(stats.mergedAfterPostApprovalCommit, true);
});

test("merge-only author sync commit after approval still does not count as a round", () => {
  const base = buildPullRequestIssue().hydrated_pull_request!;
  const issue = buildPullRequestIssue({
    hydrated_pull_request: {
      ...base,
      reviews: [
        {
          id: 15,
          body: "approved before syncing main",
          user: { id: 2, login: "reviewer-one" },
          state: ReviewState.APPROVED,
          submitted_at: new Date("2023-05-21T09:00:00Z"),
          author_association: AuthorAssociation.MEMBER,
        },
      ],
      commitList: [
        {
          commitSha: "abc123",
          commitTitle: "initial",
          user: { id: 1, login: "author" },
          commitTime: new Date("2023-05-21T08:30:00Z"),
        },
        {
          commitSha: "merge123",
          commitTitle: "Merge branch 'main' into feature",
          user: { id: 1, login: "author" },
          commitTime: new Date("2023-05-21T09:30:00Z"),
        },
      ],
      commentList: [],
      issueCommentList: [],
    },
  });

  const stats = computePullRequestEnhancedStats(issue);

  assertEquals(stats.roundsOfReview, 0);
  assertEquals(stats.botRoundsOfReview, 0);
  assertEquals(
    stats.firstApprovalAt?.toISOString(),
    "2023-05-21T09:00:00.000Z",
  );
  assertEquals(
    stats.firstEffectiveApprovalAt?.toISOString(),
    "2023-05-21T09:00:00.000Z",
  );
  assertEquals(stats.mergedAfterPostApprovalCommit, true);
});

test("ignores a merge branch into sync commit after inline review comments", () => {
  const base = buildPullRequestIssue().hydrated_pull_request!;
  const issue = buildPullRequestIssue({
    hydrated_pull_request: {
      ...base,
      commentList: [
        {
          id: 17,
          path: "src/widget.ts",
          body: "please rename this helper",
          user: { id: 2, login: "reviewer-one" },
          created_at: new Date("2023-05-21T09:00:00Z"),
          updated_at: new Date("2023-05-21T09:00:00Z"),
          author_association: AuthorAssociation.MEMBER,
        },
      ],
      commitList: [
        {
          commitSha: "abc123",
          commitTitle: "initial",
          user: { id: 1, login: "author" },
          commitTime: new Date("2023-05-21T08:30:00Z"),
        },
        {
          commitSha: "merge123",
          commitTitle: "Merge branch 'main' into feature/anonymized-task",
          user: { id: 1, login: "author" },
          commitTime: new Date("2023-05-21T09:30:00Z"),
        },
      ],
      issueCommentList: [],
      reviews: [],
    },
  });

  const stats = computePullRequestEnhancedStats(issue);

  assertEquals(stats.roundsOfReview, 0);
  assertEquals(stats.botRoundsOfReview, 0);
  assertEquals(stats.firstReviewAt?.toISOString(), "2023-05-21T09:00:00.000Z");
});

test("counts a non-merge web-flow commit as an author response", () => {
  const base = buildPullRequestIssue().hydrated_pull_request!;
  const issue = buildPullRequestIssue({
    hydrated_pull_request: {
      ...base,
      commentList: [
        {
          id: 16,
          path: "src/widget.ts",
          body: "please rename this helper",
          user: { id: 2, login: "reviewer-one" },
          created_at: new Date("2023-05-21T09:00:00Z"),
          updated_at: new Date("2023-05-21T09:00:00Z"),
          author_association: AuthorAssociation.MEMBER,
        },
      ],
      commitList: [
        {
          commitSha: "abc123",
          commitTitle: "initial",
          user: { id: 1, login: "author" },
          commitTime: new Date("2023-05-21T08:30:00Z"),
        },
        {
          commitSha: "webui123",
          commitTitle: "apply requested rename",
          user: { id: 99, login: "web-flow" },
          commitTime: new Date("2023-05-21T09:30:00Z"),
        },
      ],
    },
  });

  const stats = computePullRequestEnhancedStats(issue);

  assertEquals(stats.roundsOfReview, 1);
  assertEquals(stats.botRoundsOfReview, 0);
});

test("preserves legacy bot-only windows but uses submission timing with complete linkage", () => {
  const base = buildPullRequestIssue().hydrated_pull_request!;
  const issue = buildPullRequestIssue({
    user: { id: 1, login: "author" },
    hydrated_pull_request: {
      ...base,
      user: { id: 1, login: "author" },
      commentList: [
        {
          id: 51,
          path: "src/service.ts",
          body: "bot check before review",
          user: { id: 2, login: "review-bot[bot]" },
          created_at: new Date("2026-01-21T09:00:00Z"),
          updated_at: new Date("2026-01-21T09:00:00Z"),
          author_association: AuthorAssociation.NONE,
        },
        {
          id: 52,
          path: "src/schema.ts",
          body: "could this field name be clearer?",
          user: { id: 3, login: "reviewer-one" },
          created_at: new Date("2026-01-21T09:10:00Z"),
          updated_at: new Date("2026-01-21T09:10:00Z"),
          author_association: AuthorAssociation.MEMBER,
        },
        {
          id: 53,
          path: "src/model.ts",
          body: "can this setter return this?",
          user: { id: 4, login: "reviewer-two" },
          created_at: new Date("2026-01-21T09:20:00Z"),
          updated_at: new Date("2026-01-21T11:05:00Z"),
          author_association: AuthorAssociation.MEMBER,
        },
        {
          id: 54,
          path: "src/service.ts",
          body: "bot check after first fix",
          user: { id: 2, login: "review-bot[bot]" },
          created_at: new Date("2026-01-21T10:05:00Z"),
          updated_at: new Date("2026-01-21T10:05:00Z"),
          author_association: AuthorAssociation.NONE,
        },
      ],
      reviews: [
        {
          id: 61,
          body: "",
          user: { id: 1, login: "author" },
          state: ReviewState.COMMENTED,
          submitted_at: new Date("2026-01-21T09:00:00Z"),
          author_association: AuthorAssociation.CONTRIBUTOR,
        },
        {
          id: 62,
          body: "",
          user: { id: 2, login: "review-bot[bot]" },
          state: ReviewState.COMMENTED,
          submitted_at: new Date("2026-01-21T09:00:00Z"),
          author_association: AuthorAssociation.NONE,
        },
        {
          id: 63,
          body: "",
          user: { id: 1, login: "author" },
          state: ReviewState.COMMENTED,
          submitted_at: new Date("2026-01-21T09:10:00Z"),
          author_association: AuthorAssociation.CONTRIBUTOR,
        },
        {
          id: 64,
          body: "",
          user: { id: 4, login: "reviewer-two" },
          state: ReviewState.COMMENTED,
          submitted_at: new Date("2026-01-21T11:05:00Z"),
          author_association: AuthorAssociation.MEMBER,
        },
      ],
      commitList: [
        {
          commitSha: "a1",
          commitTitle: "initial",
          user: { id: 1, login: "author" },
          commitTime: new Date("2026-01-21T08:30:00Z"),
        },
        {
          commitSha: "a2",
          commitTitle: "address first review",
          user: { id: 1, login: "author" },
          commitTime: new Date("2026-01-21T10:00:00Z"),
        },
        {
          commitSha: "a3",
          commitTitle: "address later suggestion",
          user: { id: 1, login: "author" },
          commitTime: new Date("2026-01-21T11:30:00Z"),
        },
      ],
    },
  });

  const stats = computePullRequestEnhancedStats(issue);

  // Legacy PRs keep their original timing, including the bot-only second window.
  assertEquals(
    getReviewTimingMode(issue.hydrated_pull_request!),
    ReviewTimingMode.LEGACY,
  );
  assertEquals(stats.roundsOfReview, 1);
  assertEquals(stats.botRoundsOfReview, 1);

  const pr = issue.hydrated_pull_request!;
  // Add complete review linkage without changing comment or commit timestamps.
  pr.commentList.forEach((comment, index) => {
    comment.pull_request_review_id = 100 + index;
  });
  pr.reviews = pr.commentList.map((comment, index) => ({
    id: 100 + index,
    body: "",
    user: comment.user,
    state: ReviewState.COMMENTED,
    submitted_at:
      index === 2 ? new Date("2026-01-21T11:05:00Z") : comment.created_at,
    author_association: comment.author_association,
  }));
  assertEquals(getReviewTimingMode(pr), ReviewTimingMode.REVIEW_LINKED);
  const linkedStats = computePullRequestEnhancedStats(issue);
  assertEquals(linkedStats.roundsOfReview, 2);
  assertEquals(linkedStats.botRoundsOfReview, 0);
  assertEquals(linkedStats.firstReviewAt, stats.firstReviewAt);
});

test("keeps first approval separate from effective approval", () => {
  const base = buildPullRequestIssue().hydrated_pull_request!;
  const issue = buildPullRequestIssue({
    hydrated_pull_request: {
      ...base,
      commentList: [
        {
          id: 11,
          path: "mod.ts",
          body: "nit after approval",
          user: { id: 3, login: "reviewer-two" },
          created_at: new Date("2023-05-21T09:30:00Z"),
          updated_at: new Date("2023-05-21T09:30:00Z"),
          author_association: AuthorAssociation.MEMBER,
        },
      ],
      reviews: [
        {
          id: 12,
          body: "approved early",
          user: { id: 2, login: "reviewer-one" },
          state: ReviewState.APPROVED,
          submitted_at: new Date("2023-05-21T09:00:00Z"),
          author_association: AuthorAssociation.MEMBER,
        },
        {
          id: 13,
          body: "approved after updates",
          user: { id: 3, login: "reviewer-two" },
          state: ReviewState.APPROVED,
          submitted_at: new Date("2023-05-21T10:30:00Z"),
          author_association: AuthorAssociation.MEMBER,
        },
      ],
      commitList: [
        {
          commitSha: "abc123",
          commitTitle: "initial",
          user: { id: 1, login: "author" },
          commitTime: new Date("2023-05-21T08:30:00Z"),
        },
        {
          commitSha: "def456",
          commitTitle: "follow-up",
          user: { id: 1, login: "author" },
          commitTime: new Date("2023-05-21T10:00:00Z"),
        },
      ],
    },
  });

  const stats = computePullRequestEnhancedStats(issue);

  assertEquals(stats.roundsOfReview, 1);
  assertEquals(stats.botRoundsOfReview, 0);
  assertEquals(
    stats.firstApprovalAt?.toISOString(),
    "2023-05-21T09:00:00.000Z",
  );
  assertEquals(
    stats.firstEffectiveApprovalAt?.toISOString(),
    "2023-05-21T10:30:00.000Z",
  );
  assertEquals(stats.mergedAfterPostApprovalCommit, false);
});

test("falls back to first approval when no approval happens after last author commit", () => {
  const base = buildPullRequestIssue().hydrated_pull_request!;
  const issue = buildPullRequestIssue({
    hydrated_pull_request: {
      ...base,
      reviews: [
        {
          id: 12,
          body: "approved before final commit",
          user: { id: 2, login: "reviewer-one" },
          state: ReviewState.APPROVED,
          submitted_at: new Date("2023-05-21T09:00:00Z"),
          author_association: AuthorAssociation.MEMBER,
        },
      ],
      commitList: [
        {
          commitSha: "abc123",
          commitTitle: "initial",
          user: { id: 1, login: "author" },
          commitTime: new Date("2023-05-21T08:30:00Z"),
        },
        {
          commitSha: "def456",
          commitTitle: "final tweak",
          user: { id: 1, login: "author" },
          commitTime: new Date("2023-05-21T10:00:00Z"),
        },
      ],
    },
  });

  const stats = computePullRequestEnhancedStats(issue);

  assertEquals(stats.roundsOfReview, 0);
  assertEquals(stats.botRoundsOfReview, 0);
  assertEquals(
    stats.firstApprovalAt?.toISOString(),
    "2023-05-21T09:00:00.000Z",
  );
  assertEquals(
    stats.firstEffectiveApprovalAt?.toISOString(),
    "2023-05-21T09:00:00.000Z",
  );
  assertEquals(stats.mergedAfterPostApprovalCommit, true);
});

test("flags merged PRs when the author commits after the latest approval", () => {
  const base = buildPullRequestIssue().hydrated_pull_request!;
  const issue = buildPullRequestIssue({
    hydrated_pull_request: {
      ...base,
      merged_at: new Date("2023-05-21T11:00:00Z"),
      commentList: [
        {
          id: 21,
          path: "mod.ts",
          body: "please fix this",
          user: { id: 3, login: "reviewer-c" },
          created_at: new Date("2023-05-21T09:30:00Z"),
          updated_at: new Date("2023-05-21T09:30:00Z"),
          author_association: AuthorAssociation.MEMBER,
        },
      ],
      reviews: [
        {
          id: 22,
          body: "approved early",
          user: { id: 2, login: "reviewer-b" },
          state: ReviewState.APPROVED,
          submitted_at: new Date("2023-05-21T09:15:00Z"),
          author_association: AuthorAssociation.MEMBER,
        },
        {
          id: 23,
          body: "approved after fixes",
          user: { id: 3, login: "reviewer-c" },
          state: ReviewState.APPROVED,
          submitted_at: new Date("2023-05-21T10:20:00Z"),
          author_association: AuthorAssociation.MEMBER,
        },
      ],
      commitList: [
        {
          commitSha: "a1",
          commitTitle: "initial",
          user: { id: 1, login: "author" },
          commitTime: new Date("2023-05-21T08:30:00Z"),
        },
        {
          commitSha: "a2",
          commitTitle: "fix after comments",
          user: { id: 1, login: "author" },
          commitTime: new Date("2023-05-21T10:00:00Z"),
        },
        {
          commitSha: "a3",
          commitTitle: "final tweak before merge",
          user: { id: 1, login: "author" },
          commitTime: new Date("2023-05-21T10:45:00Z"),
        },
      ],
    },
  });

  const stats = computePullRequestEnhancedStats(issue);

  assertEquals(stats.roundsOfReview, 1);
  assertEquals(stats.botRoundsOfReview, 0);
  assertEquals(
    stats.firstApprovalAt?.toISOString(),
    "2023-05-21T09:15:00.000Z",
  );
  assertEquals(
    stats.firstEffectiveApprovalAt?.toISOString(),
    "2023-05-21T09:15:00.000Z",
  );
  assertEquals(stats.mergedAfterPostApprovalCommit, true);
});

test("counts a bot-only round separately from human rounds", () => {
  const base = buildPullRequestIssue().hydrated_pull_request!;
  const issue = buildPullRequestIssue({
    hydrated_pull_request: {
      ...base,
      commentList: [
        {
          id: 31,
          path: "mod.ts",
          body: "bot suggestion",
          user: { id: 2, login: "chatgpt-codex-connector[bot]" },
          created_at: new Date("2023-05-21T09:00:00Z"),
          updated_at: new Date("2023-05-21T09:00:00Z"),
          author_association: AuthorAssociation.NONE,
        },
        {
          id: 32,
          path: "mod.ts",
          body: "human note",
          user: { id: 3, login: "reviewer" },
          created_at: new Date("2023-05-21T10:00:00Z"),
          updated_at: new Date("2023-05-21T10:00:00Z"),
          author_association: AuthorAssociation.MEMBER,
        },
      ],
      commitList: [
        {
          commitSha: "a1",
          commitTitle: "initial",
          user: { id: 1, login: "author" },
          commitTime: new Date("2023-05-21T08:30:00Z"),
        },
        {
          commitSha: "a2",
          commitTitle: "respond to bot",
          user: { id: 1, login: "author" },
          commitTime: new Date("2023-05-21T09:30:00Z"),
        },
        {
          commitSha: "a3",
          commitTitle: "respond to human",
          user: { id: 1, login: "author" },
          commitTime: new Date("2023-05-21T10:30:00Z"),
        },
      ],
    },
  });

  const stats = computePullRequestEnhancedStats(issue);

  assertEquals(stats.roundsOfReview, 1);
  assertEquals(stats.botRoundsOfReview, 1);
});

test("prefers a human round when bot and human comments happen before the same commit", () => {
  const base = buildPullRequestIssue().hydrated_pull_request!;
  const issue = buildPullRequestIssue({
    hydrated_pull_request: {
      ...base,
      commentList: [
        {
          id: 41,
          path: "mod.ts",
          body: "bot suggestion",
          user: { id: 2, login: "chatgpt-codex-connector[bot]" },
          created_at: new Date("2023-05-21T09:00:00Z"),
          updated_at: new Date("2023-05-21T09:00:00Z"),
          author_association: AuthorAssociation.NONE,
        },
        {
          id: 42,
          path: "mod.ts",
          body: "human note",
          user: { id: 3, login: "reviewer" },
          created_at: new Date("2023-05-21T09:10:00Z"),
          updated_at: new Date("2023-05-21T09:10:00Z"),
          author_association: AuthorAssociation.MEMBER,
        },
      ],
      commitList: [
        {
          commitSha: "a1",
          commitTitle: "initial",
          user: { id: 1, login: "author" },
          commitTime: new Date("2023-05-21T08:30:00Z"),
        },
        {
          commitSha: "a2",
          commitTitle: "respond to combined feedback",
          user: { id: 1, login: "author" },
          commitTime: new Date("2023-05-21T09:30:00Z"),
        },
      ],
    },
  });

  const stats = computePullRequestEnhancedStats(issue);

  assertEquals(stats.roundsOfReview, 1);
  assertEquals(stats.botRoundsOfReview, 0);
});

test.each([
  { login: "automation", type: "Bot", bot: true },
  { login: "person[bot]", type: "User", bot: false },
  { login: "legacy[bot]", type: undefined, bot: true },
  { login: "person", type: null, bot: false },
])(
  "uses GitHub type for review signals and rounds: $login / $type",
  ({ login, type, bot }) => {
    const issue = buildPullRequestIssue();
    const pr = issue.hydrated_pull_request!;
    const user = { id: 2, login, type };
    const time = new Date("2023-05-21T09:00:00Z");
    pr.commentList = [
      {
        id: 10,
        path: "file.ts",
        body: "feedback",
        user,
        created_at: time,
        updated_at: time,
        author_association: AuthorAssociation.NONE,
      },
    ];
    pr.issueCommentList = [
      {
        id: 11,
        body: "feedback",
        user,
        created_at: time,
        updated_at: time,
        author_association: AuthorAssociation.NONE,
      },
    ];
    pr.reviews = [
      {
        id: 12,
        body: "approved",
        user,
        state: ReviewState.APPROVED,
        submitted_at: time,
        author_association: AuthorAssociation.NONE,
      },
    ];
    pr.commitList.push({
      commitSha: "fix",
      commitTitle: "address feedback",
      user: pr.user,
      commitTime: new Date("2023-05-21T10:00:00Z"),
    });
    const stats = computePullRequestEnhancedStats(issue);
    assertEquals(stats.roundsOfReview, bot ? 0 : 1);
    assertEquals(stats.botRoundsOfReview, bot ? 1 : 0);
    assertEquals(stats.firstReviewAt, bot ? null : time);
    assertEquals(stats.firstApprovalAt, bot ? null : time);
  },
);
