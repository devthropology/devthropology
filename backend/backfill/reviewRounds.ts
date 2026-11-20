import { HydratedIssue } from "../models/gh/issue.ts";

// This logic is intentionally narrow because it predates the enhanced PR stats
// work. A "round" only starts from non-author PR review comments
// (`pull_request_comment` / `commentList`) and ignores formal review objects
// like APPROVED-with-body as well as issue-thread comments. That can feel odd:
// a reviewer can approve, the author can push more work, and this still returns
// 0 rounds unless there was an inline PR review comment.

interface Event {
  timestamp: Date;
  isCommit: boolean;
  userId: number;
}

export function computeRoundsFromIssue(issue: HydratedIssue): number {
  if (issue.hydrated_pull_request === undefined) {
    return 0;
  }
  const pr = issue.hydrated_pull_request;
  const commitTimes: Array<[number, Date]> = pr.commitList.map((commit) => [
    commit.user.id,
    commit.commitTime,
  ]);
  const commentTimes: Array<[number, Date]> = pr.commentList.map((comment) => {
    if (comment.user === null) throw new Error("comment.user is null");
    return [comment.user.id, comment.created_at];
  });
  return computeRoundsOfReviews(pr.user.id, commitTimes, commentTimes);
}

export function computeRoundsOfReviews(
  prAuthorId: number,
  commits: Array<[number, Date]>,
  comments: Array<[number, Date]>,
): number {
  const events: Event[] = [];
  commits.forEach((commit) =>
    events.push({ timestamp: commit[1], isCommit: true, userId: commit[0] }),
  );
  comments.forEach((comment) =>
    events.push({ timestamp: comment[1], isCommit: false, userId: comment[0] }),
  );

  // Sort in ascending order
  events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  let rounds = 0;
  let lastWasComment = false;
  for (const event of events) {
    if (event.userId !== prAuthorId && !event.isCommit) {
      lastWasComment = true;
    } else if (event.isCommit && lastWasComment) {
      rounds += 1;
      lastWasComment = false;
    }
  }

  return rounds;
}
