# Skill: Rounds of Review Investigator

Investigate a single pull request's review timeline and explain why legacy and
enhanced review metrics differ.

## Connection

Use Postgres via `psql`. Do not read `.env` directly; source it in the shell and
use `DATABASE_URL_PG`.

```bash
set -a && source .env && psql "$DATABASE_URL_PG" -c "SELECT ..."
```

## Read-Only

Only run `SELECT` queries. Never mutate data.

## Goal

For a given `pull_request_id` or GitHub PR number (`issue.gh_issue_id`), build a
succinct timeline that explains:

- what the stored legacy rounds value is
- what the enhanced stats values are
- which events likely caused each value
- whether bots or automation affected the result

## Core Tables

- `issue` - PR author, title, created/closed times, GitHub PR number
- `pull_request` - merge time, target branch
- `pull_request_round_of_review` - legacy rounds
- `pull_request_enhanced_stats` - enhanced first review / approval fields
- `pull_request_review` - formal reviews (`APPROVED`, `COMMENTED`, etc.)
- `pull_request_comment` - inline PR review comments
- `issue_comment` - top-level PR thread comments
- `pull_request_commit` - commits on the PR
- `user` - GitHub login for authors/reviewers/commenters

## Minimal Query Workflow

1. Fetch the summary row first.
2. Fetch commit times and messages.
3. Fetch formal review timestamps and states.
4. Fetch counts for PR review comments and issue comments.
5. Only preview comment bodies if needed; default to timestamp/login/counts to
   stay token-efficient.

## Timeline Style

Default to a compact timeline. Avoid full comment bodies unless they are needed
to explain a weird case.

Good default fields:

- timestamp
- login
- event type (`commit`, `review`, `pr_comment`, `issue_comment`)
- review state for formal reviews
- short commit message preview

When reading comments, prefer `LEFT(body, 120)` rather than the full body.

## Canonical Summary Query

```sql
SELECT
  pr.pull_request_id,
  i.gh_issue_id,
  i.title,
  i.created_at,
  pr.merged_at,
  u.gh_login AS author_login,
  prror.rounds,
  pres.rounds_of_review,
  pres.first_review_at,
  pres.first_approval_at,
  pres.first_effective_approval_at,
  pres.merged_after_post_approval_commit
FROM pull_request pr
JOIN issue i USING (issue_id)
JOIN "user" u ON u.user_id = i.user_id
LEFT JOIN pull_request_round_of_review prror USING (pull_request_id)
LEFT JOIN pull_request_enhanced_stats pres USING (pull_request_id)
WHERE pr.pull_request_id = $pr_id OR i.gh_issue_id = $gh_pr_number;
```

## Compact Timeline Queries

Formal reviews:

```sql
SELECT prr.submitted_at, u.gh_login, prr.state
FROM pull_request_review prr
JOIN "user" u ON u.user_id = prr.user_id
WHERE prr.pull_request_id = $pr_id
ORDER BY prr.submitted_at ASC NULLS LAST;
```

Inline PR review comments:

```sql
SELECT prc.created_at, u.gh_login
FROM pull_request_comment prc
JOIN "user" u ON u.user_id = prc.user_id
WHERE prc.pull_request_id = $pr_id
ORDER BY prc.created_at ASC;
```

Top-level issue comments:

```sql
SELECT ic.created_at, u.gh_login
FROM issue_comment ic
JOIN issue i ON i.issue_id = ic.issue_id
JOIN pull_request pr ON pr.issue_id = i.issue_id
JOIN "user" u ON u.user_id = ic.user_id
WHERE pr.pull_request_id = $pr_id
ORDER BY ic.created_at ASC;
```

Commits:

```sql
SELECT prc.committed_at, u.gh_login, LEFT(prc.message, 140) AS message
FROM pull_request_commit prc
JOIN "user" u ON u.user_id = prc.user_id
WHERE prc.pull_request_id = $pr_id
ORDER BY prc.committed_at ASC;
```

## Important Nuances

### Legacy rounds

`pull_request_round_of_review.rounds` comes from `backfill/reviewRounds.ts` and
is intentionally narrow.

- Counts only non-author inline PR review comments from `pull_request_comment`
- A round happens when such a comment is followed by a later author commit
- Ignores formal review objects in `pull_request_review`
- Ignores top-level `issue_comment`
- Does not filter bots in the old computation, so bot inline comments can cause
  legacy rounds

### Enhanced stats

`pull_request_enhanced_stats` is broader and bot-aware, but still has
limitations.

- `first_review_at` uses the earliest non-author, non-`[bot]` review signal
  across:
  - `pull_request_comment`
  - `issue_comment`
  - submitted `pull_request_review`
- `first_approval_at` is the earliest non-author, non-`[bot]` `APPROVED` review
- `first_effective_approval_at` is the earliest approval after the last commit
  by the PR author when one exists; otherwise it falls back to the earliest
  available approval so public-facing metrics still have an approval timestamp
- `merged_after_post_approval_commit` is true when the PR merged after at least
  one approval, but the author pushed another commit after the latest approval

### Bot / automation caveats

- Enhanced stats only filter login names containing `[bot]`
- Automation accounts without that suffix can still count as human review
- Legacy rounds can count bot inline comments because the old logic does not
  filter them out

### Commit caveats

- Post-approval commits include both meaningful fixes and sync/rebase-style
  commits like `Merge branch 'main' into ...`
- Current enhanced approval logic treats both as "author changed the branch"
- Legacy rounds may still remain `0` if there were no inline PR review comments
- Legacy rounds can also overcount when a non-author inline PR review comment is
  followed by a sync/rebase-style author commit. In that case the old system may
  count a round even if the branch update was not a substantive response to
  review feedback.

## How to Explain Results

When answering, keep it brief and explicit:

- list the key timestamps in order
- say which event set `first_review_at`
- say which approval set `first_approval_at`
- say why `first_effective_approval_at` is set or null
- explain whether legacy rounds came from inline human comments, bot comments,
  or no qualifying comments at all
