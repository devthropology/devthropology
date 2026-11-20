# Devthropology

PR-based GitHub analytics focused on people metrics, velocity, and knowledge
risk.

Pipeline: GitHub PR data &rarr; Postgres &rarr; Remix UI dashboards and reports.

## Repository layout

- `frontend/` — React Router UI and frontend-specific dependencies.
- `backend/` — API, CLI, cron runners, server models, data access, and tests.
- `shared/` — Browser-safe models and utilities used by both applications.
- `tools/` — Repository maintenance tooling.

The root package owns repo tooling and shortcuts; backend and frontend are pnpm
workspaces with one root lockfile. `shared/` and `tools/` remain plain directories.
The root declares Zod for shared models, tsx for root scripts, and Hono for the
compatibility smoke tool. Application dependencies belong to their workspace.

Run `pnpm dev` for the API and `pnpm startFe` for the UI. Root CLI shortcuts keep
the caller's working directory; other workspace commands run inside their package.
DB commands stay at the root. Backend tests deliberately run from the root to
preserve fixture paths and include `shared/` tests.

Use `pnpm test:backend [file]` or `pnpm test:frontend [file]` for focused tests;
`pnpm test` runs both. Use `pnpm check` for backend/test types and
`pnpm check:frontend` for frontend types. Frontend tooling versions remain separate.

## Setup

Use the Node version pinned in `.node-version` and the pnpm version pinned in
`package.json` (currently 12.10.1). Keep `frontend/.node-version` aligned with the
root pin: Cloudflare Pages reads it from the configured `frontend` build root,
so no `NODE_VERSION` dashboard override is needed.
Install pnpm with `npm install --global pnpm@12.10.1`, then run
`pnpm install --frozen-lockfile` once at the repository root.
Only reviewed dependency build scripts are allowed in `pnpm-workspace.yaml`.
Lint and formatting use oxlint/oxfmt; tests use Vitest. Deno is not required.

Run the API with `pnpm start`, or `pnpm dev` for watch mode. Run database
migrations with `pnpm db:migrate`. The API uses `DATABASE_URL_PG`; migrations
use `DATABASE_URL_PG_DBMATE`. Backend configuration is loaded from the root `.env` without
overriding existing environment variables.

Create a new GitHub [token](https://github.com/settings/tokens/new) with the
following permissions:

- read:org
- repo
- read:user

Export your GitHub token under an env var named `GH_TOKEN`.

Backfill specific user(s) in repo:

```
pnpm cli backfill -r yourorg/yourrepo -u yourusername <username1 username2 ...>
```

Backfill all PRs in repo:

```
pnpm cli backfill -r yourorg/yourrepo -u yourusername -a
```

## Connect GitHub repositories (GitHub App)

Repository onboarding lives in `/app/settings`. Create a GitHub App, then set
the backend variables documented in `.env.example` (`GITHUB_APP_ID`,
`GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY_PATH` or
`GITHUB_APP_PRIVATE_KEY_BASE64`, `GITHUB_APP_CLIENT_ID`,
`GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_CALLBACK_URL`). Keep the private key
outside the repository.

GitHub App settings (replace the origin with your frontend URL; use HTTPS
outside local development):

- Callback URLs: `http://localhost:3002/auth/github/callback` and
  `http://localhost:3002/app/settings/github`.
- Setup URL: `http://localhost:3002/app/settings/github`; enable **Redirect on
  update**.
- Leave **Request user authorization during installation** unchecked.
- Read-only permissions: repository **Metadata**, **Pull requests**,
  **Issues**, and **Contents**; organization **Members** (to verify org
  ownership). No write permissions are needed.

Then sign in with GitHub, open `/app/settings`, click **Add repositories**,
install the app on an account or organization you own, and select repositories.
Adding repositories does not start a sync.

## Self-hosted production server

Runs the built frontend on Node with `@react-router/serve` (no Cloudflare,
Vite, or file watchers). The backend runs as a separate process. Migrations do
not run automatically.

```sh
pnpm install --frozen-lockfile
pnpm run build:prod

# Terminal 1
BACKEND_PORT=8003 pnpm run start:api

# Terminal 2
VITE_FRONTEND_PORT=3003 VITE_BACKEND_PORT=8003 \
  ALLOW_INSECURE_LOCAL_HTTP=true pnpm run start:prod
```

Open http://localhost:3003/login. Restart the backend after creating users via
the CLI to refresh its auth cache.

The frontend does not load `.env`; export its variables in the shell or service
environment. They are read at runtime, so no rebuild is needed:

- `VITE_FRONTEND_PORT` (default `3000`).
- `VITE_BACKEND_API_URL`, or `VITE_BACKEND_PORT` (default `8000`). Keep the
  backend's `BACKEND_PORT` aligned.
- `FRONTEND_HOST` (default `localhost`). Use the same hostname in the browser
  and OAuth callbacks; cookies are not shared with `127.0.0.1`.
- `ALLOW_INSECURE_LOCAL_HTTP` (default off). Loopback-only local testing; keep
  it off for HTTPS deployments.
- `SESSION_SECRET` (required in production). Signs session cookies; use a
  long random value (`openssl rand -base64 32`). Comma-separate values to
  rotate; the first signs. On Cloudflare Pages, set it as an encrypted secret.
  Development falls back to an insecure built-in value.

Error reporting is opt-in: Sentry stays disabled unless a DSN is set
(`SENTRY_DSN` for the backend and Pages Functions, `VITE_SENTRY_DSN` at build
time for the browser). Cloudflare Pages builds require `VITE_BACKEND_API_URL`
(your API's URL) at build time; the build fails without it.

Build output goes to `frontend/build-self-hosted/`. At runtime, keep it along
with the frontend and root `node_modules` and workspace manifests. TLS and
process supervision are not provided.

## GitHub archive storage (optional)

Raw GitHub API responses can be archived locally and uploaded to S3 or
Cloudflare R2. See `backend/features/githubArchive/README.md` and the
`GH_ARCHIVE_*` variables in `.env.example`.

```dotenv
GH_ARCHIVE_LOCAL=true
GH_ARCHIVE_S3=true
GH_ARCHIVE_PREFIX=gh_api_archive/local
GH_ARCHIVE_S3_BUCKET=<your-bucket>
GH_ARCHIVE_S3_REGION=auto
GH_ARCHIVE_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
```

For AWS S3, omit the endpoint and set the bucket's region. Provide bucket-scoped
credentials via `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` or a local
`AWS_PROFILE`, at runtime only; never bake them into images. The Dockerfiles
store captures and pending uploads in `/data/github-archive`; mount persistent
storage there. No retention policy is configured.

## Devthropology CLI

Install the agent-context CLI from the repository root (requires Node 26+):

```sh
pnpm install --frozen-lockfile
cd backend
pnpm link --global
```

This links `devthropology` into pnpm’s global bin directory, which must be on your
`PATH`. The command works from any directory and uses this checkout and its
installed dependencies; keep both in place. No compilation or Deno is required.
If you previously installed the compiled binary, remove that old copy so it does
not shadow the pnpm-linked command (`command -v devthropology`).

Alternatively, run it from the repository root without installing a command:

```sh
pnpm devthropology related-files path/to/file.ts
```

To remove the linked command, run `pnpm remove --global @devthropology/backend`.

Required environment variables:

```
export DEVTHROPOLOGY_API_URL="http://localhost:8002"
export DEVTHROPOLOGY_API_TOKEN="your-bearer-token"
export DEVTHROPOLOGY_OWNER="your-org"
export DEVTHROPOLOGY_REPO="your-repo"
```

Use repository-relative paths:

```
devthropology related-files path/to/file.ts
```

See `AGENTS.md` for full dev commands, port configuration, testing, and coding
conventions.

## Contributing

```
brew install pre-commit
```

---

## Database Schema

### Core Entity Hierarchy

Every GitHub Pull Request is stored as an **`issue`** with a child
**`pull_request`** record. The `issue` table is the root record and the
authoritative source for author, title, state, and timestamps. The
`pull_request` table extends it 1:1 with merge info, branch names, and aggregate
counts from GitHub's API.

```
repository
  └── issue                          (the root record for every PR)
       ├── pull_request              (1:1 via issue_id)
       │    ├── pull_request_review
       │    ├── pull_request_comment
       │    ├── pull_request_commit
       │    ├── pull_request_file
       │    ├── pull_request_round_of_review   (1:1, computed at backfill)
       │    └── computed_pull_request_metrics   (1:1, denormalized)
       └── issue_comment
```

### Tables

#### Core Data (ingested from GitHub API)

| Table                  | Description                                                     | Key Columns                                                                                                                           |
| ---------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `repository`           | GitHub repos tracked by the platform                            | `org`, `name`                                                                                                                         |
| `user`                 | GitHub users (not app users)                                    | `gh_user_id`, `gh_login`                                                                                                              |
| `issue`                | Root record for every PR. Author = `user_id`                    | `repository_id`, `user_id`, `gh_issue_id`, `state`, `created_at`, `closed_at`, `issue_type_id`                                        |
| `issue_type`           | Enum: 1=issue, 2=pull_request, 5=default                        | `name`                                                                                                                                |
| `pull_request`         | 1:1 extension of issue for PRs                                  | `issue_id` (unique), `merged_at`, `target_branch`, `additions`, `deletions`, `changed_files`, `comment_count`, `review_comment_count` |
| `pull_request_review`  | Formal review submissions (Approve / Request Changes / Comment) | `pull_request_id`, `user_id`, `state`, `body`, `submitted_at`                                                                         |
| `pull_request_comment` | Inline code review comments on specific file lines              | `pull_request_id`, `user_id`, `path`, `body`                                                                                          |
| `issue_comment`        | Top-level conversation comments on the PR page                  | `issue_id`, `user_id`, `body`                                                                                                         |
| `pull_request_commit`  | Individual commits within a PR                                  | `pull_request_id`, `user_id`, `sha`, `committed_at`                                                                                   |
| `pull_request_file`    | Files changed in a PR                                           | `pull_request_id`, `filename`, `status`, `additions`, `deletions`, `previous_filename`                                                |
| `issue_backfill`       | Tracks which issues have been backfilled                        | `issue_id`                                                                                                                            |

#### Computed / Denormalized

| Table                           | Description                                                                                                                                     |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `pull_request_round_of_review`  | Single `rounds` integer per PR, computed at backfill time                                                                                       |
| `computed_pull_request_metrics` | Denormalized PR metrics for fast queries: `contributor_age_days`, file counts by status, `merged_at`, `target_branch`, `additions`, `deletions` |
| `computed_user_metrics`         | Pre-computed ranked metrics (prs_merged, lines_modified, prs_reviewed, pr_comments_added) per user/repo/period with rank                        |
| `computed_repository_overview`  | Single row per repo with aggregate stats: PR counts, user counts, file/LOC estimates, top file types                                            |
| `computed_filesystem`           | Hierarchical file tree stored as JSONB nodes (see Filesystem section below)                                                                     |
| `user_activity`                 | Per-user/per-repo first/last seen timestamps and activity types                                                                                 |

#### Auth & Sync

| Table                       | Description                                             |
| --------------------------- | ------------------------------------------------------- |
| `auth_users` / `auth_roles` | App authentication (separate from GitHub users)         |
| `sync_api_keys`             | GitHub API keys used for sync jobs                      |
| `sync_modes`                | Sync mode definitions (e.g., full backfill, latest PRs) |
| `sync_repositories`         | Which repos to sync, which mode, how many to fetch      |
| `sync_jobs`                 | Sync job history with timing                            |

### Key Foreign Key Relationships

```
issue.user_id                           → user.user_id
issue.repository_id                     → repository.repository_id
issue.issue_type_id                     → issue_type.issue_type_id
pull_request.issue_id                   → issue.issue_id           (UNIQUE, 1:1)
pull_request_review.pull_request_id     → pull_request
pull_request_review.user_id             → user
pull_request_comment.pull_request_id    → pull_request
pull_request_comment.user_id            → user
pull_request_commit.pull_request_id     → pull_request
pull_request_commit.user_id             → user
pull_request_file.pull_request_id       → pull_request
issue_comment.issue_id                  → issue
issue_comment.user_id                   → user
pull_request_round_of_review.pull_request_id → pull_request        (UNIQUE, 1:1)
computed_pull_request_metrics.pull_request_id → pull_request        (PK, 1:1)
user_activity (user_id, repository_id)  → user, repository         (UNIQUE pair)
```

### The Three Comment Tables

There are three distinct tables that capture feedback on a PR. This mirrors
GitHub's own API structure:

| Table                  | GitHub API Source          | What It Stores                                           | Has `path`? | Joined Via        |
| ---------------------- | -------------------------- | -------------------------------------------------------- | ----------- | ----------------- |
| `issue_comment`        | `GET /issues/{n}/comments` | Top-level conversation comments                          | No          | `issue_id`        |
| `pull_request_comment` | `GET /pulls/{n}/comments`  | Inline code comments on specific file lines              | Yes         | `pull_request_id` |
| `pull_request_review`  | `GET /pulls/{n}/reviews`   | Formal review events (Approve, Request Changes, Comment) | No          | `pull_request_id` |

Most analytics queries `UNION ALL` across all three tables to get complete
review activity.

Note: `issue_comment` is linked via `issue_id`, not `pull_request_id`. To
correlate with a PR, queries join through
`issue_comment → issue → pull_request`.

#### `pull_request_review` States and the Empty Body Problem

The `pull_request_review` table has a `state` field and an optional `body`. The
`state` values are:

| State               | Meaning                                                                    |
| ------------------- | -------------------------------------------------------------------------- |
| `APPROVED`          | Reviewer approved the PR                                                   |
| `CHANGES_REQUESTED` | Reviewer requested changes before merge                                    |
| `COMMENTED`         | Reviewer left a comment without approving or requesting changes            |
| `DISMISSED`         | A prior approval or change request was dismissed (e.g., after new commits) |
| `PENDING`           | Review is in progress, not yet submitted (rare in stored data)             |

The critical nuance is the `body` field. GitHub creates a `pull_request_review`
record in two different scenarios:

1. **The reviewer submits a formal review** (clicks "Approve", "Request
   changes", or "Submit review" with a summary comment). In this case `body`
   contains the summary text, or is empty if they just clicked the button
   without typing anything.

2. **The reviewer posts an inline comment** without submitting a formal review.
   GitHub still creates a `pull_request_review` row with `state = 'COMMENTED'`
   and `body = ''` as a container/parent for the inline comment. The actual
   comment text lives in `pull_request_comment`, not here.

This means **`COMMENTED` + empty body is noise** — it's just GitHub's way of
grouping inline comments under a review record. These rows represent ~52% of all
`pull_request_review` records and carry no meaningful content of their own.

The distribution from real data:

```
state               | body   | count   | what it represents
--------------------|--------|---------|-------------------------------------------
APPROVED            | empty  | 156,718 | Clicked "Approve" with no summary text
APPROVED            | has    |  24,054 | Clicked "Approve" and wrote a summary
CHANGES_REQUESTED   | empty  |   3,854 | Requested changes via inline comments only
CHANGES_REQUESTED   | has    |   4,110 | Requested changes with a summary comment
COMMENTED           | empty  | 255,572 | Container for inline comments (NOISE)
COMMENTED           | has    |  12,651 | Submitted a review with just a comment
DISMISSED           | empty  |  23,937 | Prior review was dismissed, no body
DISMISSED           | has    |   6,670 | Prior review was dismissed, had body
PENDING             | empty  |      10 | In-progress review (rarely stored)
```

#### How Queries Filter Reviews

Different queries handle this differently depending on what they're measuring:

**Reviewer stats (counting meaningful review actions):**

```sql
WHERE prr.body <> '' OR prr.state = 'APPROVED'
```

This includes all approvals (even without a summary) and any review with actual
text, but excludes `COMMENTED` + empty body noise.

**Author stats (counting comments received on a PR):**

```sql
WHERE NOT (prr.body = '' AND prr.state = 'COMMENTED')
```

Same effect — keeps everything except the noise rows.

**Comment counting (for "how many comments on this PR"):** Reviews are only
counted as a "comment" when `body <> ''`. The `COMMENTED` + empty rows are
skipped entirely since the actual comment text lives in `pull_request_comment`.

---

## Terminology & Metrics

### Author vs. Reviewer

The **author** of a PR is always `issue.user_id` — the person who opened the
issue/PR. Any user who comments on, reviews, or interacts with a PR they did not
author is considered a **reviewer** for that PR.

All review metric queries exclude the author from reviewer counts:

```sql
WHERE issue_author_id <> reviewer_user_id
```

### Bot Filtering

Bot accounts are identified by string matching on the GitHub login:

```sql
WHERE u.gh_login NOT LIKE '%[bot]%'
```

Comment counts are typically broken into four buckets: author comments,
non-author human comments, bot comments, and (on the reviews page)
user-of-interest comments.

### Rounds of Review

A **round of review** represents one cycle of "reviewer gave feedback, then
author pushed new code." The value is computed at backfill time
(`backend/backfill/reviewRounds.ts`) and stored as a single integer in
`pull_request_round_of_review`.

**Algorithm:** Merge all commits and comments on a PR into a single timeline
sorted by timestamp. Walk the timeline:

1. See a **non-author comment** &rarr; set a flag
2. See a **commit** while the flag is set &rarr; increment rounds, clear the
   flag

Multiple consecutive reviewer comments before a push count as 1 round. Multiple
consecutive commits after feedback also count as 1 round. A PR with 0 rounds
means it was merged without any feedback-then-push cycles.

### Contributor Age

`computed_pull_request_metrics.contributor_age_days` measures how long a PR
author has been active in the repository at the time of merge, based on their
`first_seen_timestamp` from `user_activity`. This powers contributor age bucket
analysis (new / rising / core / veteran).

### First Reviewer

Many queries use
`ROW_NUMBER() OVER (PARTITION BY pull_request_id ORDER BY
action_time ASC)`
across the union of all three comment tables to identify who responded first on
each PR. This drives "first review count" and "time to first review" metrics.

---

## Debugging Cold Starts

The Remix app supports a few page URL query params that forward debug headers to
the backend so you can simulate a sleeping or slow API.

- `debugSleepMs`: base sleep duration added to matching backend requests
- `debugSleepReduceByMs`: amount removed from the sleep on each repeated request
  for the same endpoint, useful for simulating a cold first hit that warms up on
  retry
- `debugSleepPaths`: comma-separated backend path filters; exact match by
  default, or prefix match with `*`

Examples:

```text
http://localhost:<frontend-port>/app?debugSleepMs=8s&debugSleepReduceByMs=2s
http://localhost:<frontend-port>/app?debugSleepMs=8000&debugSleepPaths=/api/repository
http://localhost:<frontend-port>/app?debugSleepMs=8s&debugSleepReduceByMs=2s&debugSleepPaths=/api/repository/<repository-id>/overview
http://localhost:<frontend-port>/app?debugSleepMs=8s&debugSleepReduceByMs=2s&debugSleepPaths=/api/repository/<repository-id>/reports/contributors,/api/repository/<repository-id>/reports/monthly,/api/repository/<repository-id>/dashboard
http://localhost:<frontend-port>/app?debugSleepMs=8s&debugSleepPaths=/api/repository/<repository-id>/*
```

Notes:

- Durations support `ms` and `s` suffixes
- These params are intended for manual debugging only
- Debug sleep is only honored for authenticated `admin` / `superuser` requests
- The homepage error states no longer auto-retry the whole route after 1.2s;
  use the visible `Retry` button when you want to trigger a reload
- `debugSleepReduceByMs` is tracked per endpoint, so different backend routes
  can warm up independently

---

## Features

### Computed Filesystem

The filesystem feature builds a virtual representation of the repository's file
tree from PR history. It answers questions like "who owns this directory?" and
"is this area of code at risk?"

**Code:** `backend/services/fileSystemTreeBuilder.ts`,
`backend/services/fileSystemService.ts`

#### How It Works

```
pull_request_file rows (all merged PRs on main/master)
  → buildRenameChains()        resolve file renames to canonical names
  → buildPathNodes()           build path→node map with lifecycle handling
  → aggregateStatsBottomUp()   roll up stats from files → folders
  → enrich with user_activity  add last_seen_anywhere for each contributor
  → compute health scores      assign critical/warn/caution/neutral/good
  → persist to computed_filesystem table
```

**Step 1 — Rename Resolution:** Renames are sorted newest-first. The most recent
name becomes the canonical name, and all older names map to it. Multi-hop chains
(A&rarr;B&rarr;C) collapse to the final name. Ping-pong renames (A&rarr;B, then
B&rarr;A) resolve to whichever name is most recent.

**Step 2 — Path Node Construction:** Activities are processed chronologically.
Each file path is split into segments, creating intermediate folder nodes at
each level. When a file has `status = 'removed'`, its entire activity history is
cleared — if the file is later re-added, only post-deletion activities count.
Empty folders (no living children) are pruned.

**Step 3 — Bottom-Up Aggregation:** File stats are computed first (adds, subs,
unique PR count, per-contributor breakdowns). Then folders are processed from
deepest to shallowest, merging child stats. PR counts use **set unions** (not
sums) to avoid double-counting a PR that touches multiple files in the same
folder.

**Step 4 — Health Scoring:** Each node gets a health state:

| State    | Criteria                                          |
| -------- | ------------------------------------------------- |
| critical | All contributors inactive repo-wide for >3 months |
| warn     | >75% of changes authored by inactive contributors |
| caution  | No changes in 18+ months                          |
| good     | >10 merged PRs in last 30 days                    |
| neutral  | Default / moderate activity                       |

#### Storage

Each node is stored as one row in `computed_filesystem`:

| Column          | Description                                     |
| --------------- | ----------------------------------------------- |
| `repository_id` | FK to repository                                |
| `path`          | Full path, e.g. `backend/services/auth.ts`      |
| `parent_path`   | Parent folder path (null for level-1 nodes)     |
| `level`         | Depth, 1-indexed                                |
| `node_data`     | JSONB blob containing the full `FileSystemNode` |

The `node_data` JSONB contains: `total_adds`, `total_subs`, `total_prs`,
`total_files`, `first_seen`, `last_updated`, a `contributors[]` array (with
per-contributor `pct_of_changes`, `num_prs`, `first_seen_in_directory`,
`last_seen_in_directory`, `last_seen_anywhere`), and `health`.

#### Example Row

```json
{
  "name": "Chart.yaml",
  "path": "service/kubernetes/Chart.yaml",
  "type": "file",
  "level": 3,
  "total_prs": 5,
  "total_adds": 35,
  "total_subs": 6,
  "total_changes": 41,
  "total_contributors": 5,
  "first_seen": "2025-01-03T19:15:36.000Z",
  "last_updated": "2025-10-23T15:14:39.000Z",
  "health": { "state": "neutral", "reason": "Moderate activity" },
  "contributors": [
    {
      "gh_login": "test-user",
      "pct_of_changes": 70.7,
      "num_prs": 1,
      "last_seen_anywhere": "2026-02-19T17:23:31.000Z",
      "last_seen_in_directory": "2025-01-03T19:15:36.000Z"
    }
  ]
}
```

The API serves nodes lazily by `parent_path` and `level` — the frontend requests
one level at a time as the user drills into folders. A unique index on
`(repository_id, path)` supports O(1) lookups for the PR list endpoint.

### Relationships (PR Interaction Graph)

The relationships feature builds a directed graph of reviewer&rarr;author
interactions from PR activity. It answers questions like "who reviews whose
code?" and "which people are tightly coupled?"

**Route:** `/app/relationships`

#### Architecture

```
                      ┌─────────────────────────────────────┐
                      │  UserRelationshipService            │
backfiller / cron     │  backend/services/                  │
tools/recompute─┐     │  userRelationshipService.ts         │
                │     │                                     │
                ▼     │  recomputeForRepository()           │
            orchestrate│    1. fetch raw events (parallel)   │
                      │    2. computeRelationshipEdges()    │
                      │    3. persistEdges()                │
                      └──────┬──────────────┬───────────────┘
                             │              │
         ┌───────────────────┘              └──────────────┐
         ▼                                                 ▼
UserRelationshipRepository                    relationshipWeighting.ts
backend/repository/                                   backend/repository/
postgresUserRelationshipRepository.ts         (pure function, no I/O)
- fetchReviewEvents()                         - computeRelationshipEdges()
- fetchCommentEvents()                        - scorePrContribution()
- fetchPrRounds()
- persistEdges()
- getRelationshipGraph()  ← read side for API
```

**Key files:**

| File                                                | Role                                                         |
| --------------------------------------------------- | ------------------------------------------------------------ |
| `backend/repository/relationshipWeighting.ts`               | Pure scoring function, Zod input schemas, formula docs       |
| `backend/repository/relationshipWeighting.test.ts`          | Unit tests (17 cases, no DB needed)                          |
| `backend/repository/userRelationshipRepository.ts`          | Interface + output types (`EdgeDataV1`, `RelationshipGraph`) |
| `backend/repository/postgresUserRelationshipRepository.ts`  | SQL queries for fetch/persist/read                           |
| `backend/services/userRelationshipService.ts`       | Orchestrator: fetch &rarr; compute &rarr; persist            |
| `frontend/app/routes/app.relationships.tsx`            | Remix route + loader                                         |
| `frontend/app/components/RelationshipGraph.client.tsx` | sigma.js + graphology visualization                          |
| `tools/recompute-relationships.ts`                  | Standalone CLI to recompute all repos                        |

#### Scoring Formula

Edges are scored **per PR**, then summed across all PRs for a given (reviewer,
author) pair. The formula is defined in `backend/repository/relationshipWeighting.ts`:

```
Per PR:
  commentScore  = commentCount > 0 ? 1 + log2(commentCount) : 0
  approvalScore = approvals * 1.5
  crScore       = changesRequested * 2
  prScore       = commentScore + approvalScore + crScore

Edge weight = round(sum of prScore across all PRs)
```

Where `commentCount` is the sum of inline comments, conversation comments, and
reviews-with-body for that reviewer on that PR.

**Event sources and what counts:**

| Source                                            | Counts as              | Notes                                 |
| ------------------------------------------------- | ---------------------- | ------------------------------------- |
| `pull_request_review` state=APPROVED              | Approval (+1.5)        | Flat per approval                     |
| `pull_request_review` state=CHANGES_REQUESTED     | Changes requested (+2) | Flat per CR                           |
| `pull_request_review` with non-empty body         | Comment (in log2 pool) | Substantive review text               |
| `pull_request_review` state=DISMISSED             | Dropped                | No meaningful reviewer signal         |
| `pull_request_review` state=COMMENTED, empty body | Dropped                | Noise (container for inline comments) |
| `pull_request_comment` (inline)                   | Comment (in log2 pool) | Code-level feedback                   |
| `issue_comment`                                   | Comment (in log2 pool) | Conversation-level feedback           |

**Filters:** Self-reviews excluded (`actor != author`). Bot users filtered
(`gh_login NOT LIKE '%[bot]%'`).

**Rounds multiplier:** Uses the pre-computed
`pull_request_round_of_review.rounds` value (see
[Rounds of Review](#rounds-of-review)). A PR with 3 rounds of review gets a
~2.58x multiplier, rewarding deep back-and-forth engagement.

**Why log2?** Comment volume has diminishing returns. Leaving 10 inline comments
should not produce 10x the relationship signal of leaving 1 comment. The
`1 + log2(n)` curve means 1 comment = 1, 4 comments = 3, 16 comments = 5.

#### Storage

Edges are stored in `computed_user_relationship` (delete + insert per
repo+period, inside a transaction):

| Column           | Type    | Description                                                                                                                       |
| ---------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `repository_id`  | bigint  | FK to repository                                                                                                                  |
| `actor_user_id`  | bigint  | The reviewer                                                                                                                      |
| `target_user_id` | bigint  | The PR author                                                                                                                     |
| `period`         | text    | Time window (currently `3mo`)                                                                                                     |
| `edge_weight`    | integer | Rounded sum of per-PR scores                                                                                                      |
| `edge_data`      | jsonb   | Breakdown: `prs_touched`, `approvals`, `changes_requested`, `reviews_with_body`, `inline_comments`, `convo_comments`, `dismissed` |

#### Frontend Visualization

The graph is rendered client-side using [sigma.js](https://www.sigmajs.org/)
(WebGL) with [graphology](https://graphology.github.io/) for graph data
structures. The component (`frontend/app/components/RelationshipGraph.client.tsx`)
is lazy-loaded to avoid SSR issues with WebGL.

**Layout and clustering:**

1. Edges are filtered by a min-weight slider
2. Node size scales with total in+out weight (range 4&ndash;20)
3. Edge thickness scales with weight (range 2&ndash;8)
4. [Louvain community detection](https://en.wikipedia.org/wiki/Louvain_method)
   assigns color clusters using edge weight
5. [ForceAtlas2](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0098679)
   force-directed layout positions nodes (200 iterations, then optional live
   mode)

**Interactive features:** search by username, min-weight slider, click node/edge
for detail panels, tuning panel for Louvain resolution and ForceAtlas2 physics
parameters.

#### Future Enhancement Opportunities

These are documented in `backend/repository/relationshipWeighting.ts` header comments:

**Approval splitting** &mdash; distinguish rubber-stamp approvals from
substantive ones:

- Option A: Review has non-empty body &rarr; 2.5, else 0.75 (easy, data exists
  in `pull_request_review.body`)
- Option B: Reviewer had prior comment/CR on this PR &rarr; 2.5 (needs timeline
  query using `submitted_at`)
- Option C: A or B (most accurate)

**PR size coefficient** &mdash; scale edge weight by PR complexity:

- Option A: Line-count buckets (data exists in `pull_request.additions`,
  `deletions`)
- Option B: `min(1 + log10(linesChanged / 100), 2)` (smooth curve)
- Option C: Files-touched as complexity proxy (avoids rename noise, uses
  `pull_request.changed_files`)
- Option D: Skip &mdash; noisiest signal, needs validation against real data
  first
