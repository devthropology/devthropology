# Skill: Database Explorer

Explore the Devthropology Postgres database to answer natural language questions
about pull request activity, contributor metrics, review patterns, and code
ownership.

## Connection

Connect via `psql` using the project `.env` file. Try local database first and
if not found, ask user, if not specified, to query the remote prod database.

```bash
source .env && psql "$DATABASE_URL_PG" -c "SELECT ..."
##
source .env && psql "$DATABASE_URL_PG_REMOTE" -c "SELECT ..."
```

## IMPORTANT: READ-ONLY

**NEVER run INSERT, UPDATE, DELETE, DROP, TRUNCATE, ALTER, or any other
mutating statement. This database is READ-ONLY for this skill. All queries
must be SELECT statements only.**

## Repository Scoping

Almost all queries require a `repository_id`. The user will refer to a
repository by name (e.g., "sentry", "identity-api"). Resolve it from the
`repository` table:

```sql
SELECT repository_id, org, name FROM repository WHERE name ILIKE '%sentry%';
```

Match on `name` by default. If multiple rows match, ask the user to clarify
which org/repo they mean. Once resolved, use the `repository_id` integer in all
subsequent queries.

## Query Guidelines

- Always show the SQL query before running it so the user can see what you're
  doing. Then execute it and explain the results.
- Use `LIMIT` on exploratory queries to avoid dumping huge result sets.
- Prefer CTEs (`WITH ...`) for readability over deeply nested subqueries.
- Use `::date` or `date_trunc()` for readable timestamps in output.

## Core Schema

### Entity Hierarchy

Every GitHub Pull Request is stored as an `issue` (the root record) with a
child `pull_request` record (1:1 via `issue_id`).

```
repository
  +-- issue                        (root record; author = issue.user_id)
       +-- pull_request            (1:1, merge info, branch, size stats)
       |    +-- pull_request_review    (formal review: approve/reject/comment)
       |    +-- pull_request_comment   (inline code comments on file lines)
       |    +-- pull_request_commit    (individual commits)
       |    +-- pull_request_file      (files changed)
       +-- issue_comment           (top-level conversation comments)
```

### Key Tables and Columns

**`repository`** - GitHub repos tracked by the platform.
- `repository_id` (PK), `org`, `name`

**`user`** - GitHub user accounts (not app auth users).
- `user_id` (PK), `gh_user_id` (GitHub's numeric ID), `gh_login` (GitHub username)
- NOTE: The table is quoted as `"user"` in SQL because `user` is a reserved word.

**`issue`** - The root record for every PR and issue.
- `issue_id` (PK), `repository_id` (FK), `user_id` (FK - this is the **author**)
- `gh_issue_id` (the PR number visible on GitHub, e.g. #1234)
- `title`, `body`, `state` ('open' or 'closed')
- `created_at`, `updated_at`, `closed_at`
- `issue_type_id` (FK): **2 = pull request**, 1 = issue, 5 = default

**`pull_request`** - 1:1 extension of issue for PRs.
- `pull_request_id` (PK), `issue_id` (FK, UNIQUE)
- `merged_at` (NULL if not merged), `target_branch`, `source_branch`
- `additions`, `deletions`, `changed_files`
- `comment_count` (GitHub's count of issue comments)
- `review_comment_count` (GitHub's count of inline review comments)

**`pull_request_review`** - Formal review submissions.
- `pull_request_review_id` (PK), `pull_request_id` (FK), `user_id` (FK)
- `state`: APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED, PENDING
- `body` (may be empty string), `submitted_at`

**`pull_request_comment`** - Inline code review comments on specific lines.
- `pull_request_comment_id` (PK), `pull_request_id` (FK), `user_id` (FK)
- `body`, `path` (file path the comment is on), `created_at`

**`issue_comment`** - Top-level conversation comments on the PR/issue page.
- `issue_comment_id` (PK), `issue_id` (FK - note: NOT pull_request_id), `user_id` (FK)
- `body`, `created_at`

**`pull_request_commit`** - Commits within a PR.
- `pull_request_commit_id` (PK), `pull_request_id` (FK), `user_id` (FK)
- `sha`, `message`, `committed_at`

**`pull_request_file`** - Files changed in a PR.
- `pull_request_file_id` (PK), `pull_request_id` (FK)
- `filename`, `status` (added, removed, modified, renamed)
- `additions`, `deletions`, `changes`, `previous_filename` (for renames)

### Computed / Precomputed Tables

These are derived from the core tables and are useful for questions about
aggregated metrics. They exist for performance and may not cover every possible
query.

**`pull_request_round_of_review`** - One row per PR.
- `pull_request_id` (FK, UNIQUE), `rounds` (integer)
- A "round" = reviewer gave feedback, then author pushed new code. Computed at
  backfill time.

**`computed_user_metrics`** - Pre-ranked user metrics per repo and time period.
- `user_id`, `repository_id`, `period` (e.g., '1_month', '3_month', '1_year', 'all_time')
- `prs_merged`, `lines_modified`, `prs_reviewed`, `pr_comments_added`
- `prs_merged_rank`, `lines_modified_rank`, `prs_reviewed_rank`, `pr_comments_added_rank`
- Useful for "top contributors" or "how does X rank?" questions without
  recomputing from scratch.

**`computed_pull_request_metrics`** - Denormalized PR-level metrics.
- `pull_request_id` (PK), `repository_id`, `contributor_age_days`
- `merged_at`, `target_branch`, `additions`, `deletions`
- `file_count_added`, `file_count_modified`, `file_count_removed`, `file_count_renamed`

**`user_activity`** - Per-user, per-repo activity window.
- `user_id`, `repository_id` (UNIQUE pair)
- `first_seen_timestamp`, `last_seen_timestamp`
- `activity_types` (jsonb array of activity type strings)
- Useful for "when did user X first contribute?" or "who has been inactive?"

**`computed_repository_overview`** - Single summary row per repo.
- `repository_id` (PK), `total_prs`, `merged_prs`, `open_prs`, `closed_prs`
- `total_users`, `active_users_3mo`
- `estimated_total_files`, `estimated_total_loc`

**`computed_filesystem`** - Hierarchical file tree stored as JSONB.
- `repository_id`, `path`, `parent_path`, `level`
- `node_data` (JSONB containing: total_prs, total_adds, total_subs,
  contributors array with per-user ownership percentages, health status)
- Useful for "who owns this file/directory?" or "what's the health of this path?"

## Essential Filtering Patterns

Almost every query about PR activity needs these filters. Forgetting any of
them will produce incorrect numbers.

```sql
-- Only pull requests (not issues)
WHERE i.issue_type_id = 2

-- Only merged PRs (most metrics care about merged, not abandoned)
AND pr.merged_at IS NOT NULL

-- Only mainline branch (exclude feature-to-feature merges)
AND LOWER(pr.target_branch) IN ('main', 'master')

-- Exclude bot accounts
AND u.gh_login NOT LIKE '%[bot]%'
```

### Author vs. Reviewer

The **author** of a PR is `issue.user_id`. When counting reviews, always
exclude the author from reviewer metrics:

```sql
-- "reviews by others" pattern
WHERE prr.user_id <> i.user_id
```

## The Three Comment Tables

There are three tables with "comment" data. This mirrors GitHub's API. To get
ALL feedback on a PR, you must UNION across all three.

| Table | What It Stores | Joined Via |
|---|---|---|
| `issue_comment` | Top-level conversation comments | `issue_id` (must join issue -> pull_request to correlate with PR) |
| `pull_request_comment` | Inline code comments on file lines | `pull_request_id` |
| `pull_request_review` | Formal review events (Approve/Reject/Comment) | `pull_request_id` |

### The `pull_request_review` Empty Body Problem

GitHub creates a `pull_request_review` record in two scenarios:
1. A reviewer submits a formal review (Approve, Request Changes, or Comment
   with summary text).
2. A reviewer posts an inline comment WITHOUT submitting a formal review.
   GitHub creates a review with `state = 'COMMENTED'` and `body = ''` as a
   container. The actual text is in `pull_request_comment`.

**`COMMENTED` + empty body is noise.** These are ~52% of all review rows and
carry no content. Filter them:

```sql
-- Include meaningful reviews only
WHERE prr.body <> '' OR prr.state = 'APPROVED'

-- Or equivalently, exclude the noise
WHERE NOT (prr.body = '' AND prr.state = 'COMMENTED')
```

### Standard "All Review Activity" UNION Pattern

Use this pattern when you need to find all feedback on a PR (or by a user):

```sql
WITH all_activity AS (
    -- Formal reviews (exclude noise)
    SELECT prr.user_id, prr.submitted_at AS activity_time, 'review' AS source
    FROM pull_request_review prr
    WHERE prr.pull_request_id = $pr_id
      AND (prr.body <> '' OR prr.state = 'APPROVED')

    UNION ALL

    -- Inline code comments
    SELECT prc.user_id, prc.created_at, 'inline_comment'
    FROM pull_request_comment prc
    WHERE prc.pull_request_id = $pr_id

    UNION ALL

    -- Top-level conversation comments (join through issue)
    SELECT ic.user_id, ic.created_at, 'issue_comment'
    FROM issue_comment ic
    JOIN issue i ON ic.issue_id = i.issue_id
    JOIN pull_request pr ON i.issue_id = pr.issue_id
    WHERE pr.pull_request_id = $pr_id
)
SELECT ...
```

## Common Join Paths

### PR authored by a user
```
"user" u
  JOIN issue i ON i.user_id = u.user_id
  JOIN pull_request pr ON pr.issue_id = i.issue_id
WHERE i.repository_id = $repo_id AND i.issue_type_id = 2
```

### PR reviewed by a user (via formal reviews)
```
"user" u
  JOIN pull_request_review prr ON prr.user_id = u.user_id
  JOIN pull_request pr ON pr.pull_request_id = prr.pull_request_id
  JOIN issue i ON i.issue_id = pr.issue_id
WHERE i.repository_id = $repo_id AND i.issue_type_id = 2
  AND prr.user_id <> i.user_id  -- exclude self-reviews
```

### Files changed in a PR
```
pull_request pr
  JOIN pull_request_file prf ON prf.pull_request_id = pr.pull_request_id
```

### Comments on a PR (all three tables)
Use the UNION pattern above.

## Example Queries

### How many PRs has a user merged in the last N months?

```sql
SELECT COUNT(*) AS merged_prs
FROM issue i
JOIN "user" u ON u.user_id = i.user_id
JOIN pull_request pr ON pr.issue_id = i.issue_id
WHERE i.repository_id = $repo_id
  AND i.issue_type_id = 2
  AND u.gh_login = 'username'
  AND pr.merged_at IS NOT NULL
  AND LOWER(pr.target_branch) IN ('main', 'master')
  AND pr.merged_at >= NOW() - INTERVAL '2 months';
```

### Find PRs where two specific people both interacted

```sql
WITH pr_participants AS (
    SELECT pr.pull_request_id, prr.user_id
    FROM pull_request_review prr
    JOIN pull_request pr ON pr.pull_request_id = prr.pull_request_id
    JOIN issue i ON i.issue_id = pr.issue_id
    WHERE i.repository_id = $repo_id AND i.issue_type_id = 2
      AND (prr.body <> '' OR prr.state = 'APPROVED')
    UNION
    SELECT prc.pull_request_id, prc.user_id
    FROM pull_request_comment prc
    JOIN pull_request pr ON pr.pull_request_id = prc.pull_request_id
    JOIN issue i ON i.issue_id = pr.issue_id
    WHERE i.repository_id = $repo_id AND i.issue_type_id = 2
    UNION
    SELECT pr.pull_request_id, ic.user_id
    FROM issue_comment ic
    JOIN issue i ON ic.issue_id = i.issue_id
    JOIN pull_request pr ON pr.issue_id = i.issue_id
    WHERE i.repository_id = $repo_id AND i.issue_type_id = 2
)
SELECT DISTINCT pp1.pull_request_id, i.title, i.gh_issue_id
FROM pr_participants pp1
JOIN pr_participants pp2 ON pp1.pull_request_id = pp2.pull_request_id
JOIN pull_request pr ON pr.pull_request_id = pp1.pull_request_id
JOIN issue i ON i.issue_id = pr.issue_id
JOIN "user" u1 ON u1.user_id = pp1.user_id
JOIN "user" u2 ON u2.user_id = pp2.user_id
WHERE u1.gh_login = 'alice' AND u2.gh_login = 'bob'
ORDER BY i.created_at DESC
LIMIT 20;
```

### Who reviewed the most PRs this quarter?

```sql
WITH reviewer_prs AS (
    SELECT prr.user_id, pr.pull_request_id
    FROM pull_request_review prr
    JOIN pull_request pr ON pr.pull_request_id = prr.pull_request_id
    JOIN issue i ON i.issue_id = pr.issue_id
    WHERE i.repository_id = $repo_id AND i.issue_type_id = 2
      AND pr.merged_at IS NOT NULL
      AND LOWER(pr.target_branch) IN ('main', 'master')
      AND prr.user_id <> i.user_id
      AND (prr.body <> '' OR prr.state = 'APPROVED')
      AND prr.submitted_at >= date_trunc('quarter', NOW())
    UNION
    SELECT prc.user_id, prc.pull_request_id
    FROM pull_request_comment prc
    JOIN pull_request pr ON pr.pull_request_id = prc.pull_request_id
    JOIN issue i ON i.issue_id = pr.issue_id
    WHERE i.repository_id = $repo_id AND i.issue_type_id = 2
      AND pr.merged_at IS NOT NULL
      AND LOWER(pr.target_branch) IN ('main', 'master')
      AND prc.user_id <> i.user_id
      AND prc.created_at >= date_trunc('quarter', NOW())
)
SELECT u.gh_login, COUNT(DISTINCT pull_request_id) AS prs_reviewed
FROM reviewer_prs rp
JOIN "user" u ON u.user_id = rp.user_id
WHERE u.gh_login NOT LIKE '%[bot]%'
GROUP BY u.gh_login
ORDER BY prs_reviewed DESC
LIMIT 20;
```

### What files does a user own the most?

```sql
SELECT
    (node_data->>'path') AS path,
    c->>'gh_login' AS contributor,
    (c->>'pct_of_changes')::numeric AS pct_ownership,
    (c->>'num_prs')::int AS num_prs,
    (node_data->>'total_changes')::int AS total_file_changes
FROM computed_filesystem,
     jsonb_array_elements(node_data->'contributors') AS c
WHERE repository_id = $repo_id
  AND (node_data->>'type') = 'file'
  AND c->>'gh_login' = 'username'
  AND (c->>'pct_of_changes')::numeric > 25
ORDER BY (c->>'pct_of_changes')::numeric DESC
LIMIT 20;
```

### Average time to first review for merged PRs

```sql
WITH first_reviews AS (
    SELECT
        pr.pull_request_id,
        MIN(prr.submitted_at) AS first_review_time,
        i.created_at AS pr_created
    FROM pull_request_review prr
    JOIN pull_request pr ON pr.pull_request_id = prr.pull_request_id
    JOIN issue i ON i.issue_id = pr.issue_id
    WHERE i.repository_id = $repo_id AND i.issue_type_id = 2
      AND pr.merged_at IS NOT NULL
      AND LOWER(pr.target_branch) IN ('main', 'master')
      AND prr.user_id <> i.user_id
      AND (prr.body <> '' OR prr.state = 'APPROVED')
    GROUP BY pr.pull_request_id, i.created_at
)
SELECT
    ROUND(AVG(EXTRACT(EPOCH FROM (first_review_time - pr_created)) / 3600), 1) AS avg_hours_to_first_review,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_review_time - pr_created)) / 3600), 1) AS median_hours
FROM first_reviews
WHERE first_review_time > pr_created;
```
