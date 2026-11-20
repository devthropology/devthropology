# App Overview

This app fetches GitHub Pull Request data for analysis.

**Uses:** XYZ (fill in later)

---

## Syncing Data

- Sync processes a number of PRs (configurable).
- Defaults to syncing all previously unsynced PRs that are **closed or merged**
  (skips open PRs to save API calls).
- Begins from most recent PR number, filters out already-synced PRs, persists
  new ones.
- After sync, a `User Activity` table is computed (used for the **Users** route
  — tracking first/last seen).

---

## App Structure

### Nav Bar

- Home
- Sync Data
- Contributors
- Reviewers
- Users

---

## Home Page

Displays three graphs:

1. **Monthly User Activity**
   - Active users per month
   - Net contributor count (growth)

2. **Daily PRs Merged**
3. **Daily Lines Changed**
4. **Daily Files Changed**

---

## Sync Data

- Initiates data sync
- Mode switching (e.g. backfill vs ongoing)
- Configurable number of PRs
- Logs (placeholder for future SSE support)

---

## Contributor Data

Contributor-specific reports (defaults to last month)

> ⚠️ Can be slow — recommend precomputing views

**Fields:**

1. `contributor`
2. `active_days`
3. `open_prs_count`
4. `merged_prs_count`
5. `avg_pr_per_active_day`
6. `avg_time_to_merge` (hrs)
7. `median_time_to_merge` (hrs)
8. `avg_time_to_first_review` (hrs)
9. `median_time_to_first_review` (hrs)
10. `avg_rounds_of_review`
11. `total_comments_merged`
12. `avg_comments_per_pr`
13. `median_comments_per_pr`
14. `median_files_changed`
15. `avg_files_changed`
16. `median_lines_changed`
17. `avg_lines_changed`
18. `total_additions`
19. `total_deletions`
20. `total_changed_files`
21. `unique_files_touched_count`
22. `top_touched_package`

---

## Reviewer Data

Same structure as Contributor.

**Fields:**

1. `reviewer`
2. `active_days`
3. `review_count`
4. `first_review_count`
5. `approval_count`
6. `total_non_author_comments`
7. `median_time_as_first_reviewer` (hrs)
8. `avg_time_as_first_reviewer` (hrs)
9. `unique_authors_interacted_with`
10. `most_interacted_author`
11. `most_interacted_author_by_comments`

---

## Users

- Table with key user info; usernames are hyperlinked

---

## Users/[username]

- GitHub profile pic
- Metadata:
  - GitHub Member Since: `5/5/2014`
  - Repo Activity First Seen: `12/21/2021` (3y 4m 15d ago)
  - Last Seen: `4/14/2025` (5d ago)
  - Contributor Rank: `330th of 549`

- PR tables:
  - All PRs
  - Merged PRs
  - Open PRs
  - Last 25 PRs:
    - PR Number, Title, Created Date, Status (color-coded),\
      Lines Changed (+/-), Files Changed, Review Rounds,\
      Time Open, Comments (by author/non-author/bots, color-coded),\
      Time to First Review

> ⚠️ This view is slow to compute

---

## Known Issues

- **Daily PRs Merged** is noisy (weekend drop-off)\
  → Consider rolling up by week

- **User PR views** are slow

---

## Thoughts / Ideas

- Precompute Contributor/Reviewer views:
  - Last Month, YTD, etc.
  - Caveat: unsynced data shifts time range.\
    (e.g. Sync on Monday → view data on Wednesday = range mismatch)
  - Still likely fine for casual use

- Post-sync processing can offload analysis computation

## Ideas

### 1. Add Review Activity to User Page

Enhance the `/users/[username]` route to show review-related behavior in
addition to authored PRs.

**Note:** All metrics below should be precomputed during the post-sync phase.

#### High-Level Reviewer Metrics:

- `review_count`: Total PRs reviewed ✅
- `first_review_count`: Times they were the first reviewer ✅
- `approval_count`: Times they approved ✅
- `total_review_comments`: Total review comments made ✅
- `median_time_to_review`: Time from PR creation to their first review ✅
- `unique_authors_reviewed`: Distinct PR authors they’ve reviewed ✅
- `most_reviewed_author`: Author they've reviewed most often (optional) ✅
- `review_to_merge_delta`: Median time from their review to PR merge (optional)
  ✅

#### Recent Review Table (last 25 PRs reviewed, not authored by user):

- PR Number
- Title
- Author
- Created Date
- Reviewed On
- First Reviewer? (✅ / ❌)
- Approved? (✅ / ❌)
- Comment Count
- Time to Review
- Time to Merge

TODO:

- [ ] Move backfiller tests to a higher level class. Currently acting as a
      backfill + repository + stats test class
