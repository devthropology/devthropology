import postgres from "postgres";
import { ComputedFileSystemNode } from "../models/dbTypes.ts";

type Sql = ReturnType<typeof postgres>;

export const insertUser = `
INSERT INTO "user" (gh_user_id, gh_login)
  VALUES ($1, $2)
ON CONFLICT (gh_login)
  DO UPDATE SET
    gh_login = EXCLUDED.gh_login
  RETURNING
    user_id;
`;

export const getAllUsers = `
SELECT
    gh_user_id, gh_login, user_id
FROM
    "user"
WHERE
    gh_user_id = ANY($1)
`;

export const getRepositoryId = `
SELECT
    repository_id
FROM
    repository
WHERE
    org = $1
    AND name = $2
`;

export const insertRepository = `
INSERT INTO repository (org, name)
    VALUES ($1, $2)
RETURNING repository_id
`;

export const upsertIssue = `
INSERT INTO issue (repository_id, user_id, gh_issue_id, title, state, body, created_at, updated_at, closed_at, issue_type_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT (repository_id, gh_issue_id)
    DO UPDATE SET
        repository_id = excluded.repository_id,
        user_id = excluded.user_id,
        title = excluded.title,
        state = excluded.state,
        body = excluded.body,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        closed_at = excluded.closed_at,
        issue_type_id = excluded.issue_type_id
    RETURNING
        issue_id;
`;

export const insertPullRequest = `
INSERT INTO pull_request (issue_id, merged_at, merge_commit_sha, target_branch, source_branch, comment_count, review_comment_count, commit_count, additions, deletions, changed_files)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING
        pull_request_id;
`;

export const insertReview = `
INSERT INTO pull_request_review (pull_request_id, gh_pull_request_review_id, user_id, body, author_association, state, submitted_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
`;

export const insertComment = `
INSERT INTO pull_request_comment (pull_request_id, gh_pull_request_comment_id, user_id, path, body, author_association, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
`;

export const insertIssueComment = `
INSERT INTO issue_comment (issue_id, gh_issue_comment_id, user_id, body, author_association, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
`;

export const insertCommit = `
INSERT INTO pull_request_commit (pull_request_id, sha, message, user_id, committed_at)
    VALUES ($1, $2, $3, $4, $5)
`;

export const insertRoundOfReviews = `
INSERT INTO pull_request_round_of_review (pull_request_id, rounds)
    VALUES ($1, $2)
`;

export const insertPullRequestEnhancedStats = `
INSERT INTO pull_request_enhanced_stats (pull_request_id, rounds_of_review, bot_rounds_of_review, first_review_at, first_approval_at, first_effective_approval_at, merged_after_post_approval_commit, ai_assisted_model)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
`;

export const insertFile = `
INSERT INTO pull_request_file (pull_request_id, filename, additions, deletions, changes, status, previous_filename)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
`;

export const getRepositoryInfo = `
SELECT
    org,
    name
FROM
    repository
WHERE
    repository_id = $1;
`;

export const getPullRequestNumbersDynamicWhere = `
  SELECT
      gh_issue_id
  FROM
    issue
  LEFT JOIN
    pull_request pr
  USING (issue_id)
  JOIN
    "user"
  USING (user_id)
  WHERE
    repository_id = $1
    AND gh_login = $2
    AND {where_clause}
`;

export const debugUserActivity = `
SELECT
    r.org || '/' || r."name" AS git_repo,
    u.gh_login,
    first_seen_timestamp,
    i.gh_issue_id as first_seen_issue_id,
    first_seen_activity_type,
    i.title AS first_seen_title,
    last_seen_timestamp,
    i2.gh_issue_id as last_seen_issue_id,
    last_seen_activity_type,
    i2.title AS last_seen_title,
    COALESCE(metrics.prs_merged, 0) AS prs_merged,
    metrics.prs_merged_rank,
    COALESCE(metrics.lines_modified, 0) AS lines_modified,
    metrics.lines_modified_rank,
    COALESCE(metrics.prs_reviewed, 0) AS prs_reviewed,
    metrics.prs_reviewed_rank,
    COALESCE(metrics.pr_comments, 0) AS pr_comments,
    metrics.pr_comments_rank
FROM
    user_activity ua
    JOIN "user" u USING (user_id)
    JOIN repository r USING (repository_id)
    JOIN issue i on i.issue_id = first_seen_issue_id
    JOIN issue i2 on i2.issue_id = last_seen_issue_id
    LEFT JOIN LATERAL (
      SELECT
        MAX(CASE WHEN cum.metric_key = 'prs_merged' THEN cum.value END) AS prs_merged,
        MAX(CASE WHEN cum.metric_key = 'prs_merged' THEN cum.rank END) AS prs_merged_rank,
        MAX(CASE WHEN cum.metric_key = 'lines_modified' THEN cum.value END) AS lines_modified,
        MAX(CASE WHEN cum.metric_key = 'lines_modified' THEN cum.rank END) AS lines_modified_rank,
        MAX(CASE WHEN cum.metric_key = 'prs_reviewed' THEN cum.value END) AS prs_reviewed,
        MAX(CASE WHEN cum.metric_key = 'prs_reviewed' THEN cum.rank END) AS prs_reviewed_rank,
        MAX(CASE WHEN cum.metric_key = 'pr_comments_added' THEN cum.value END) AS pr_comments,
        MAX(CASE WHEN cum.metric_key = 'pr_comments_added' THEN cum.rank END) AS pr_comments_rank
      FROM computed_user_metrics cum
      WHERE cum.repository_id = ua.repository_id
        AND cum.user_id = ua.user_id
        AND cum.period = 'all'
    ) metrics ON TRUE
WHERE
    ua.repository_id = $1
    ORDER BY
    first_seen_timestamp;
`;

export const getReviewStats = `
WITH filtered_issues AS (
    SELECT
        i.issue_id,
        i.gh_issue_id,
        i.created_at AS issue_created_at,
        i.user_id AS issue_author_id
    FROM
        issue i
    WHERE
        i.repository_id = ANY($1::bigint[])
        AND i.created_at >= $2
        AND i.created_at < $3
),
-- 1. Gather all raw activity
all_activity AS (
    SELECT
        pr.pull_request_id,
        prr.user_id AS reviewer_id,
        prr.submitted_at AS action_time,
        fi.issue_created_at,
        fi.issue_author_id,
        'REVIEW' AS type,
        prr.state,
        CASE WHEN prr.body <> '' THEN 1 ELSE 0 END AS counts_as_comment
    FROM
        pull_request_review prr
        JOIN pull_request pr ON pr.pull_request_id = prr.pull_request_id
        JOIN filtered_issues fi ON pr.issue_id = fi.issue_id
    WHERE
        fi.issue_author_id <> prr.user_id
        AND (prr.body <> '' OR prr.state = 'APPROVED')
    UNION ALL
    SELECT
        pr.pull_request_id,
        prc.user_id AS reviewer_id,
        prc.created_at,
        fi.issue_created_at,
        fi.issue_author_id,
        'PR_COMMENT' AS type,
        NULL AS state,
        1 AS counts_as_comment
    FROM
        pull_request_comment prc
        JOIN pull_request pr ON pr.pull_request_id = prc.pull_request_id
        JOIN filtered_issues fi ON pr.issue_id = fi.issue_id
    WHERE
        fi.issue_author_id <> prc.user_id
    UNION ALL
    SELECT
        pr.pull_request_id,
        ic.user_id,
        ic.created_at,
        fi.issue_created_at,
        fi.issue_author_id,
        'ISSUE_COMMENT' AS type,
        NULL AS state,
        1 AS counts_as_comment
    FROM
        issue_comment ic
        JOIN issue i ON i.issue_id = ic.issue_id
        JOIN pull_request pr ON pr.issue_id = i.issue_id
        JOIN filtered_issues fi ON pr.issue_id = fi.issue_id
    WHERE
        fi.issue_author_id <> ic.user_id
),
-- 2. Rank globally
ranked_activity AS (
    SELECT
        a.*,
        u.gh_login,
        ROW_NUMBER() OVER (PARTITION BY a.pull_request_id ORDER BY a.action_time ASC) AS rn_global
    FROM
        all_activity a
    JOIN "user" u ON u.user_id = a.reviewer_id
    WHERE
        u.gh_login NOT LIKE '%[bot]%' -- FILTER BOTS HERE
),
-- 3. Calculate Author Interactions
author_interaction_ranks AS (
    SELECT
        ra.reviewer_id,
        u.gh_login AS author_name,
        COUNT(DISTINCT ra.pull_request_id) AS unique_prs,
        COUNT(*) AS total_interactions,
        ROW_NUMBER() OVER (PARTITION BY ra.reviewer_id ORDER BY COUNT(DISTINCT ra.pull_request_id) DESC,
            COUNT(*) DESC,
            u.gh_login ASC) AS rn_main,
        ROW_NUMBER() OVER (PARTITION BY ra.reviewer_id ORDER BY COUNT(*) DESC,
            u.gh_login ASC) AS rn_comments
    FROM
        ranked_activity ra
        JOIN "user" u ON ra.issue_author_id = u.user_id
    GROUP BY
        ra.reviewer_id,
        u.gh_login
),
-- 4. Calculate Time Metrics (rn_global here is now the TRUE global rank)
first_responder_times AS (
    SELECT
        reviewer_id,
        EXTRACT(EPOCH FROM (action_time - issue_created_at)) / 3600.0 AS time_in_hours
    FROM
        ranked_activity
    WHERE
        rn_global = 1
),
-- 5. Main Aggregation
reviewer_aggregates AS (
    SELECT
        ra.reviewer_id,
        ra.gh_login AS reviewer,
        COUNT(DISTINCT ra.action_time::date) AS active_days,
        COUNT(DISTINCT ra.pull_request_id) AS review_count,
        COUNT(DISTINCT CASE WHEN ra.rn_global = 1 THEN ra.pull_request_id END) AS first_review_count,
        COUNT(DISTINCT CASE WHEN ra.state = 'APPROVED' THEN ra.pull_request_id END) AS approval_count,
        SUM(ra.counts_as_comment) AS total_non_author_comments,
        COUNT(DISTINCT ra.issue_author_id) AS unique_authors_interacted_with
    FROM
        ranked_activity ra
    GROUP BY
        ra.reviewer_id,
        ra.gh_login
),
time_aggregates AS (
    SELECT
        reviewer_id,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY time_in_hours) AS median_time,
        AVG(time_in_hours) AS average_time
    FROM
        first_responder_times
    GROUP BY
        reviewer_id
),
-- 6. Calculate LOC Metrics per reviewer (across distinct reviewed PRs)
reviewer_pr_loc AS (
    SELECT DISTINCT
        ra.reviewer_id,
        ra.pull_request_id,
        COALESCE(pr.additions, 0) + COALESCE(pr.deletions, 0) AS lines_changed
    FROM
        ranked_activity ra
        JOIN pull_request pr ON pr.pull_request_id = ra.pull_request_id
),
loc_aggregates AS (
    SELECT
        reviewer_id,
        COALESCE(SUM(lines_changed), 0) AS total_lines_reviewed,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lines_changed) AS median_lines_per_reviewed_pr
    FROM
        reviewer_pr_loc
    GROUP BY
        reviewer_id
)
SELECT
    ra.reviewer,
    ra.active_days,
    ra.review_count,
    ra.first_review_count,
    ra.approval_count,
    ra.total_non_author_comments,
    ROUND(ta.median_time::numeric, 2) AS median_time_as_first_reviewer,
    ROUND(ta.average_time::numeric, 2) AS avg_time_as_first_reviewer,
    ra.unique_authors_interacted_with,
    mia.author_name AS most_interacted_author,
    miac.author_name AS most_interacted_author_by_comments,
    COALESCE(la.total_lines_reviewed, 0) AS total_lines_reviewed,
    ROUND(la.median_lines_per_reviewed_pr::numeric, 0) AS median_lines_per_reviewed_pr
FROM
    reviewer_aggregates ra
LEFT JOIN time_aggregates ta ON ra.reviewer_id = ta.reviewer_id
LEFT JOIN author_interaction_ranks mia ON ra.reviewer_id = mia.reviewer_id AND mia.rn_main = 1
LEFT JOIN author_interaction_ranks miac ON ra.reviewer_id = miac.reviewer_id AND miac.rn_comments = 1
LEFT JOIN loc_aggregates la ON ra.reviewer_id = la.reviewer_id
ORDER BY
    review_count DESC,
    ra.reviewer ASC;
`;

export const getReviewStatsForUsers = `
WITH target_users AS (
    SELECT user_id, gh_login 
    FROM "user" 
    WHERE gh_login = ANY($4::text[])
),
-- OPTIMIZATION: Bottom-Up Approach
-- Instead of checking every issue to see if the user is there,
-- we look at the user's logs to see which PRs they touched.
touched_pr_ids AS (
    SELECT pull_request_id FROM pull_request_review 
    WHERE user_id IN (SELECT user_id FROM target_users)
    UNION
    SELECT pull_request_id FROM pull_request_comment 
    WHERE user_id IN (SELECT user_id FROM target_users)
    -- We can join issue_comment to PRs via issue_id if strictly necessary, 
    -- but usually PR comments/reviews cover the review stats.
    -- Included here for completeness:
    UNION
    SELECT pr.pull_request_id 
    FROM issue_comment ic
    JOIN pull_request pr ON pr.issue_id = ic.issue_id
    WHERE ic.user_id IN (SELECT user_id FROM target_users)
),
-- Now we have the specific list of PR IDs. 
-- We fetch the Issue details for ONLY these PRs, filtering by date here.
relevant_context AS (
    SELECT 
        pr.pull_request_id,
        pr.issue_id,
        i.created_at AS issue_created_at,
        i.user_id AS issue_author_id
    FROM 
        pull_request pr
    JOIN 
        touched_pr_ids tpid ON pr.pull_request_id = tpid.pull_request_id
    JOIN 
        issue i ON pr.issue_id = i.issue_id
    WHERE 
        i.repository_id = ANY($1::bigint[])
        AND i.created_at >= $2
        AND i.created_at < $3
),
-- From here down, the logic is identical to before, 
-- but 'all_activity' is now small because 'relevant_context' is tiny.
all_activity AS (
    SELECT
        rc.pull_request_id,
        prr.user_id AS reviewer_id,
        prr.submitted_at AS action_time,
        rc.issue_created_at,
        rc.issue_author_id,
        'REVIEW' AS type,
        prr.state,
        CASE WHEN prr.body <> '' THEN 1 ELSE 0 END AS counts_as_comment
    FROM
        relevant_context rc
        JOIN pull_request_review prr ON rc.pull_request_id = prr.pull_request_id
    WHERE
        rc.issue_author_id <> prr.user_id
        AND (prr.body <> '' OR prr.state = 'APPROVED')

    UNION ALL

    SELECT
        rc.pull_request_id,
        prc.user_id AS reviewer_id,
        prc.created_at,
        rc.issue_created_at,
        rc.issue_author_id,
        'PR_COMMENT' AS type,
        NULL AS state,
        1 AS counts_as_comment
    FROM
        relevant_context rc
        JOIN pull_request_comment prc ON rc.pull_request_id = prc.pull_request_id
    WHERE
        rc.issue_author_id <> prc.user_id

    UNION ALL

    SELECT
        rc.pull_request_id,
        ic.user_id,
        ic.created_at,
        rc.issue_created_at,
        rc.issue_author_id,
        'ISSUE_COMMENT' AS type,
        NULL AS state,
        1 AS counts_as_comment
    FROM
        relevant_context rc
        JOIN issue_comment ic ON rc.issue_id = ic.issue_id
    WHERE
        rc.issue_author_id <> ic.user_id
),
-- Rank globally just for the PRs we care about
ranked_activity AS (
    SELECT
        a.*,
        u.gh_login,
        ROW_NUMBER() OVER (PARTITION BY a.pull_request_id ORDER BY a.action_time ASC) AS rn_global
    FROM
        all_activity a
    JOIN "user" u ON u.user_id = a.reviewer_id
    WHERE
        u.gh_login NOT LIKE '%[bot]%'
),
-- Filter for the specific user again for final aggregation
enriched_activity AS (
    SELECT ra.*
    FROM ranked_activity ra
    WHERE ra.reviewer_id IN (SELECT user_id FROM target_users)
),
author_interaction_ranks AS (
    SELECT
        ea.reviewer_id,
        u.gh_login AS author_name,
        COUNT(DISTINCT ea.pull_request_id) AS unique_prs,
        COUNT(*) AS total_interactions,
        ROW_NUMBER() OVER (PARTITION BY ea.reviewer_id ORDER BY COUNT(DISTINCT ea.pull_request_id) DESC, COUNT(*) DESC, u.gh_login ASC) AS rn_main,
        ROW_NUMBER() OVER (PARTITION BY ea.reviewer_id ORDER BY COUNT(*) DESC, u.gh_login ASC) AS rn_comments
    FROM
        enriched_activity ea
        JOIN "user" u ON ea.issue_author_id = u.user_id
    GROUP BY
        ea.reviewer_id,
        u.gh_login
),
first_responder_times AS (
    SELECT
        reviewer_id,
        EXTRACT(EPOCH FROM (action_time - issue_created_at)) / 3600.0 AS time_in_hours
    FROM
        enriched_activity
    WHERE
        rn_global = 1
),
reviewer_aggregates AS (
    SELECT
        ea.reviewer_id,
        ea.gh_login AS reviewer,
        COUNT(DISTINCT ea.action_time::date) AS active_days,
        COUNT(DISTINCT ea.pull_request_id) AS review_count,
        COUNT(DISTINCT CASE WHEN ea.rn_global = 1 THEN ea.pull_request_id END) AS first_review_count,
        COUNT(DISTINCT CASE WHEN ea.state = 'APPROVED' THEN ea.pull_request_id END) AS approval_count,
        SUM(ea.counts_as_comment) AS total_non_author_comments,
        COUNT(DISTINCT ea.issue_author_id) AS unique_authors_interacted_with
    FROM
        enriched_activity ea
    GROUP BY
        ea.reviewer_id,
        ea.gh_login
),
time_aggregates AS (
    SELECT
        reviewer_id,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY time_in_hours) AS median_time,
        AVG(time_in_hours) AS average_time
    FROM
        first_responder_times
    GROUP BY
        reviewer_id
),
-- 6. Calculate LOC Metrics per reviewer (across distinct reviewed PRs)
reviewer_pr_loc AS (
    SELECT DISTINCT
        ea.reviewer_id,
        ea.pull_request_id,
        COALESCE(pr.additions, 0) + COALESCE(pr.deletions, 0) AS lines_changed
    FROM
        enriched_activity ea
        JOIN pull_request pr ON pr.pull_request_id = ea.pull_request_id
),
loc_aggregates AS (
    SELECT
        reviewer_id,
        COALESCE(SUM(lines_changed), 0) AS total_lines_reviewed,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lines_changed) AS median_lines_per_reviewed_pr
    FROM
        reviewer_pr_loc
    GROUP BY
        reviewer_id
)
SELECT
    ra.reviewer,
    ra.active_days,
    ra.review_count,
    ra.first_review_count,
    ra.approval_count,
    ra.total_non_author_comments,
    ROUND(ta.median_time::numeric, 2) AS median_time_as_first_reviewer,
    ROUND(ta.average_time::numeric, 2) AS avg_time_as_first_reviewer,
    ra.unique_authors_interacted_with,
    mia.author_name AS most_interacted_author,
    miac.author_name AS most_interacted_author_by_comments,
    COALESCE(la.total_lines_reviewed, 0) AS total_lines_reviewed,
    ROUND(la.median_lines_per_reviewed_pr::numeric, 0) AS median_lines_per_reviewed_pr
FROM
    reviewer_aggregates ra
LEFT JOIN time_aggregates ta ON ra.reviewer_id = ta.reviewer_id
LEFT JOIN author_interaction_ranks mia ON ra.reviewer_id = mia.reviewer_id AND mia.rn_main = 1
LEFT JOIN author_interaction_ranks miac ON ra.reviewer_id = miac.reviewer_id AND miac.rn_comments = 1
LEFT JOIN loc_aggregates la ON ra.reviewer_id = la.reviewer_id
ORDER BY
    review_count DESC,
    ra.reviewer ASC;
`;

export const getAuthorStats = `
WITH all_prs AS (
    SELECT
        i.issue_id,
        i.title,
        pr.pull_request_id,
        i.gh_issue_id,
        i.created_at AS issue_created_at,
        i.user_id AS issue_author_id,
        i.repository_id,
        EXTRACT(EPOCH FROM (pr.merged_at - i.created_at)) / 3600 AS time_to_merge_hours,
        pr.merged_at
    FROM
        issue i
        LEFT JOIN pull_request pr ON pr.issue_id = i.issue_id
    WHERE
        i.repository_id = ANY($1::bigint[])
        AND i.created_at >= $2
        AND i.created_at < $3
),
merged_prs AS (
    SELECT
        *
    FROM
        all_prs
    WHERE
        merged_at IS NOT NULL
),
active_days AS (
    SELECT
        mp.issue_author_id,
        COUNT(DISTINCT mp.issue_created_at::date) AS active_days
    FROM
        merged_prs mp
    GROUP BY
        mp.issue_author_id
),
open_prs_count AS (
    SELECT
        issue_author_id,
        COUNT(*) AS open_prs_count
    FROM
        all_prs
    GROUP BY
        issue_author_id
),
merged_prs_count AS (
    SELECT
        issue_author_id,
        COUNT(*) AS merged_prs_count
    FROM
        merged_prs
    GROUP BY
        issue_author_id
),
time_to_merge_avg AS (
    SELECT
        issue_author_id,
        AVG(time_to_merge_hours) AS avg_time_to_merge
    FROM
        merged_prs
    GROUP BY
        issue_author_id
),
time_merge_prs_median AS (
    SELECT
        issue_author_id,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY time_to_merge_hours) AS median_time_to_merge
    FROM
        merged_prs GROUP BY
            issue_author_id
),
avg_rounds_of_review AS (
    SELECT
        mp.issue_author_id,
        AVG(prrr.rounds) AS avg_rounds_of_review
    FROM
        merged_prs mp
        JOIN pull_request_round_of_review prrr ON mp.pull_request_id = prrr.pull_request_id GROUP BY
            mp.issue_author_id
),
avg_pr_per_active_day AS (
    SELECT
        issue_author_id,
        COUNT(*)::float / COUNT(DISTINCT issue_created_at::date) AS avg_pr_per_active_day
    FROM
        merged_prs GROUP BY
            issue_author_id
),
reviews_and_comments AS (
    SELECT
        mp.issue_id,
        mp.gh_issue_id,
        prr.pull_request_id,
        prr.user_id AS commenter_id,
        prr.submitted_at AS action_time
    FROM
        pull_request_review prr
        JOIN merged_prs mp ON prr.pull_request_id = mp.pull_request_id
    WHERE
        prr.submitted_at IS NOT NULL
        AND NOT (prr.body = ''
            AND prr.state = 'COMMENTED')
    UNION ALL
    SELECT
        mp.issue_id,
        mp.gh_issue_id,
        prc.pull_request_id,
        prc.user_id,
        prc.created_at
    FROM
        pull_request_comment prc
        JOIN merged_prs mp ON prc.pull_request_id = mp.pull_request_id
UNION ALL
SELECT
    mp.issue_id,
    mp.gh_issue_id,
    pr.pull_request_id,
    ic.user_id,
    ic.created_at
FROM
    issue_comment ic
    JOIN issue i ON i.issue_id = ic.issue_id
    JOIN pull_request pr ON pr.issue_id = i.issue_id
    JOIN merged_prs mp ON pr.issue_id = mp.issue_id
),
comments_by_pr AS (
    SELECT
        mp.issue_author_id,
        mp.issue_id,
        COUNT(
            CASE WHEN cu.gh_login LIKE '%[bot]' THEN
                NULL -- Ignore bot comments
            ELSE
                rac.issue_id
            END) AS num_comments -- Only count human (non-bot, non-author) comments
FROM
    merged_prs mp
        LEFT JOIN reviews_and_comments rac ON mp.issue_id = rac.issue_id
            AND (rac.commenter_id IS NULL
                OR rac.commenter_id != mp.issue_author_id) -- Existing: Exclude author self-comments
        LEFT JOIN "user" cu ON rac.commenter_id = cu.user_id -- New: Join to check if commenter is a bot
        GROUP BY
            mp.issue_id,
            mp.issue_author_id
),
avg_comments_per_pr AS (
    SELECT
        issue_author_id,
        AVG(num_comments) AS avg_comments_per_pr
FROM
    comments_by_pr GROUP BY
        issue_author_id
),
median_comments_per_pr AS (
    SELECT
        issue_author_id,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY num_comments) AS median_comments_per_pr
FROM
    comments_by_pr GROUP BY
        issue_author_id
),
total_comments_merged_prs AS (
    SELECT
        issue_author_id,
        SUM(num_comments) AS total_comments_merged
FROM
    comments_by_pr GROUP BY
        issue_author_id
),
total_code_changes AS (
    SELECT
        mp.issue_author_id,
        SUM(pr.additions) AS total_additions,
    SUM(pr.deletions) AS total_deletions
FROM
    merged_prs mp
    JOIN pull_request pr ON mp.issue_id = pr.issue_id GROUP BY
        mp.issue_author_id
),
unique_files_touched AS (
    SELECT
        mp.issue_author_id,
        COUNT(DISTINCT (mp.repository_id, prf.filename)) AS num_unique_files_touched
FROM
    merged_prs mp
    JOIN pull_request_file prf ON mp.pull_request_id = prf.pull_request_id GROUP BY
        mp.issue_author_id
),
time_to_first_review AS (
    SELECT
        mp.issue_id,
        mp.gh_issue_id,
        mp.issue_created_at,
        mp.issue_author_id,
        EXTRACT(EPOCH FROM (MIN(
                    CASE WHEN cu.gh_login LIKE '%[bot]' THEN
                        NULL
                    ELSE
                        rac.action_time
                    END) - mp.issue_created_at)) / 3600 AS time_to_first_review_hours
    FROM
        merged_prs mp
        LEFT JOIN reviews_and_comments rac ON mp.pull_request_id = rac.pull_request_id
            AND (rac.commenter_id IS NULL
                OR rac.commenter_id != mp.issue_author_id)
        LEFT JOIN "user" cu ON rac.commenter_id = cu.user_id -- New join to check commenter details for bot exclusion
        GROUP BY
            mp.issue_id,
            mp.gh_issue_id,
            mp.issue_created_at,
            mp.issue_author_id
),
time_to_first_review_avg AS (
    SELECT
        issue_author_id,
        AVG(time_to_first_review_hours) AS time_to_first_review_avg
    FROM
        time_to_first_review GROUP BY
            issue_author_id
),
time_to_first_review_median AS (
    SELECT
        issue_author_id,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY time_to_first_review_hours) AS time_to_first_review_median
    FROM
        time_to_first_review GROUP BY
            issue_author_id
),
top_touched_package AS (
    SELECT
        issue_author_id,
        package,
        ROW_NUMBER() OVER (PARTITION BY issue_author_id ORDER BY COUNT(*) DESC, package ASC) AS rn
    FROM (
        SELECT
            mp.issue_author_id,
            CASE WHEN cardinality($1::bigint[]) > 1
                THEN r.org || '/' || r.name || ':'
                ELSE ''
            END || CASE WHEN STRPOS(prf.filename, '/') > 0 THEN
                SUBSTRING(prf.filename FROM 1 FOR STRPOS(prf.filename, '/') - 1)
            ELSE
                ''
            END AS package
        FROM
            merged_prs mp
            JOIN pull_request_file prf ON mp.pull_request_id = prf.pull_request_id
            JOIN repository r ON r.repository_id = mp.repository_id) AS packages GROUP BY
            issue_author_id,
            package
),
final_top_touched_package AS (
    SELECT
        issue_author_id,
        package AS top_touched_package
    FROM
        top_touched_package
    WHERE
        rn = 1
),
files_changed AS (
    SELECT
        mp.issue_author_id,
        pr.changed_files
    FROM
        merged_prs mp
        JOIN pull_request pr ON mp.issue_id = pr.issue_id
),
median_files_changed AS (
    SELECT
        issue_author_id,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY changed_files) AS median_files_changed
    FROM
        files_changed GROUP BY
            issue_author_id
),
avg_files_changed AS (
    SELECT
        issue_author_id,
        AVG(changed_files) AS avg_files_changed
    FROM
        files_changed GROUP BY
            issue_author_id
),
lines_changed AS (
    SELECT
        mp.issue_author_id,
        (pr.additions + pr.deletions) AS lines
    FROM
        merged_prs mp
        JOIN pull_request pr ON mp.issue_id = pr.issue_id
),
median_lines_changed AS (
    SELECT
        issue_author_id,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lines) AS median_lines_changed
    FROM
        lines_changed GROUP BY
            issue_author_id
),
avg_lines_changed AS (
    SELECT
        issue_author_id,
        AVG(lines) AS avg_lines_changed
    FROM
        lines_changed GROUP BY
            issue_author_id
)
    SELECT
        u.gh_login AS author,
        ad.active_days,
        npo.open_prs_count,
        tmp.merged_prs_count,
        ROUND(apad.avg_pr_per_active_day::numeric, 2) AS avg_pr_per_active_day,
    ROUND(ttm.avg_time_to_merge::numeric, 2) AS avg_time_to_merge,
    ROUND(m.median_time_to_merge::numeric, 2) AS median_time_to_merge,
    ROUND(atfa.time_to_first_review_avg::numeric, 2) AS avg_time_to_first_review,
    ROUND(mtfa.time_to_first_review_median::numeric, 2) AS median_time_to_first_review,
    ROUND(arr.avg_rounds_of_review::numeric, 2) AS avg_rounds_of_review,
    COALESCE(tcmp.total_comments_merged, 0) AS total_comments_merged,
    ROUND(cs.avg_comments_per_pr::numeric, 2) AS avg_comments_per_pr,
    mc.median_comments_per_pr,
    ROUND(mfc.median_files_changed::numeric, 2) AS median_files_changed,
    ROUND(afc.avg_files_changed::numeric, 2) AS avg_files_changed,
    ROUND(mlc.median_lines_changed::numeric, 2) AS median_lines_changed,
    ROUND(alc.avg_lines_changed::numeric, 2) AS avg_lines_changed,
    tcc.total_additions,
    tcc.total_deletions,
    uft.num_unique_files_touched AS unique_files_touched_count,
    ftp.top_touched_package
FROM
    active_days ad
    JOIN "user" u ON u.user_id = ad.issue_author_id
    LEFT JOIN open_prs_count npo ON u.user_id = npo.issue_author_id
    LEFT JOIN merged_prs_count tmp ON u.user_id = tmp.issue_author_id
    LEFT JOIN time_to_merge_avg ttm ON u.user_id = ttm.issue_author_id
    LEFT JOIN time_merge_prs_median m ON u.user_id = m.issue_author_id
    LEFT JOIN avg_rounds_of_review arr ON u.user_id = arr.issue_author_id
    LEFT JOIN avg_pr_per_active_day apad ON u.user_id = apad.issue_author_id
    LEFT JOIN total_comments_merged_prs tcmp ON u.user_id = tcmp.issue_author_id
    LEFT JOIN avg_comments_per_pr cs ON u.user_id = cs.issue_author_id
    LEFT JOIN median_comments_per_pr mc ON u.user_id = mc.issue_author_id
    LEFT JOIN total_code_changes tcc ON u.user_id = tcc.issue_author_id
    LEFT JOIN unique_files_touched uft ON u.user_id = uft.issue_author_id
    LEFT JOIN time_to_first_review_avg atfa ON u.user_id = atfa.issue_author_id
    LEFT JOIN time_to_first_review_median mtfa ON u.user_id = mtfa.issue_author_id
    LEFT JOIN final_top_touched_package ftp ON u.user_id = ftp.issue_author_id
    LEFT JOIN median_files_changed mfc ON u.user_id = mfc.issue_author_id
    LEFT JOIN median_lines_changed mlc ON u.user_id = mlc.issue_author_id
    LEFT JOIN avg_files_changed afc ON u.user_id = afc.issue_author_id
    LEFT JOIN avg_lines_changed alc ON u.user_id = alc.issue_author_id
WHERE
    ($4::text[] IS NULL OR u.gh_login = ANY($4::text[]))
ORDER BY
    merged_prs_count DESC,
    u.gh_login ASC
`;

export const getContributorAgeBuckets = `
SELECT bucket, COUNT(*) AS count
FROM (
  SELECT CASE
    WHEN cprm.contributor_age_days < 90 THEN 'new'
    WHEN cprm.contributor_age_days < 365 THEN 'rising'
    WHEN cprm.contributor_age_days < 1095 THEN 'core'
    ELSE 'veteran'
  END AS bucket
  FROM computed_pull_request_metrics cprm
  WHERE cprm.repository_id = $1
    AND cprm.target_branch IN ('main', 'master')
    AND cprm.merged_at IS NOT NULL
    AND cprm.merged_at > $2
    AND cprm.merged_at <= $3
) bucketed
GROUP BY bucket;
`;

export const getMergesByDayz = `
WITH pr_base AS (
  SELECT
    pr.pull_request_id,
    pr.merged_at::date AS merge_date,
    pr.additions,
    pr.deletions,
    pr.changed_files,
    i.issue_id
  FROM
    issue i
    JOIN pull_request pr USING (issue_id)
    JOIN repository r USING (repository_id)
  WHERE
    r.repository_id = $1
    AND (pr.target_branch = 'master' OR pr.target_branch = 'main')
    AND pr.merged_at IS NOT NULL
    AND pr.merged_at > $2
    AND pr.merged_at <= $3
),
file_counts AS (
  SELECT
    prf.pull_request_id,
    SUM(CASE WHEN prf.status = 'added' THEN 1 ELSE 0 END) AS files_added,
    SUM(CASE WHEN prf.status = 'modified' THEN 1 ELSE 0 END) AS files_modified,
    SUM(CASE WHEN prf.status = 'removed' THEN 1 ELSE 0 END) AS files_removed,
    SUM(CASE WHEN prf.status = 'renamed' THEN 1 ELSE 0 END) AS files_renamed
  FROM
    pull_request_file prf
    INNER JOIN pr_base pb ON prf.pull_request_id = pb.pull_request_id
  GROUP BY
    prf.pull_request_id
)
SELECT
  pb.merge_date,
  COUNT(*) AS prs_merged,
  SUM(pb.additions + pb.deletions) AS total_lines_changed,
  SUM(pb.changed_files) AS total_files_changed,
  SUM(pb.additions) AS total_lines_added,
  SUM(pb.deletions) AS total_lines_deleted,
  SUM(fc.files_added) AS files_added,
  SUM(fc.files_modified) AS files_modified,
  SUM(fc.files_removed) AS files_removed,
  SUM(fc.files_renamed) AS files_renamed
FROM
  pr_base pb
  LEFT JOIN file_counts fc ON pb.pull_request_id = fc.pull_request_id
GROUP BY
  pb.merge_date
ORDER BY
  pb.merge_date DESC;
`;

export const getMergesByDay = `
SELECT
  cprm.merged_at::date AS merge_date,
  count(cprm.pull_request_id) AS prs_merged,
  sum(cprm.additions + cprm.deletions) AS total_lines_changed,
  sum(cprm.changed_files) AS total_files_changed,
  sum(cprm.additions) AS total_lines_added,
  sum(cprm.deletions) AS total_lines_deleted,
  COALESCE(SUM(cprm.files_added), 0) AS files_added,
  COALESCE(SUM(cprm.files_modified), 0) AS files_modified,
  COALESCE(SUM(cprm.files_removed), 0) AS files_removed,
  COALESCE(SUM(cprm.files_renamed), 0) AS files_renamed,
  COALESCE(array_agg(cprm.contributor_age_days) FILTER (WHERE cprm.contributor_age_days IS NOT NULL), '{}') AS contributor_ages
FROM
  computed_pull_request_metrics cprm
WHERE
  cprm.repository_id = $1
  AND cprm.target_branch IN ('main', 'master')
  AND cprm.merged_at IS NOT NULL
  AND cprm.merged_at > $2
  AND cprm.merged_at <= $3
GROUP BY
  cprm.merged_at::date
ORDER BY
  merge_date DESC;
`;

export const getMergesByDay2 = `
WITH pr_base AS (
  SELECT
    pr.pull_request_id,
    pr.merged_at::date AS merge_date,
    pr.additions,
    pr.deletions,
    pr.changed_files,
    i.issue_id
  FROM
    issue i
    JOIN pull_request pr USING (issue_id)
    JOIN repository r USING (repository_id)
  WHERE
    r.repository_id = $1
    AND (pr.target_branch = 'master' OR pr.target_branch = 'main')
    AND pr.merged_at IS NOT NULL
    AND pr.merged_at > $2
    AND pr.merged_at <= $3
),
file_counts AS (
  SELECT
    prf.pull_request_id,
    SUM(CASE WHEN prf.status = 'added' THEN 1 ELSE 0 END) AS files_added,
    SUM(CASE WHEN prf.status = 'modified' THEN 1 ELSE 0 END) AS files_modified,
    SUM(CASE WHEN prf.status = 'removed' THEN 1 ELSE 0 END) AS files_removed,
    SUM(CASE WHEN prf.status = 'renamed' THEN 1 ELSE 0 END) AS files_renamed
  FROM
    pull_request_file prf
    INNER JOIN pr_base pb ON prf.pull_request_id = pb.pull_request_id
  GROUP BY
    prf.pull_request_id
)
SELECT
  pb.merge_date,
  COUNT(*) AS prs_merged,
  SUM(pb.additions + pb.deletions) AS total_lines_changed,
  SUM(pb.changed_files) AS total_files_changed,
  SUM(pb.additions) AS total_lines_added,
  SUM(pb.deletions) AS total_lines_deleted,
  SUM(fc.files_added) AS files_added,
  SUM(fc.files_modified) AS files_modified,
  SUM(fc.files_removed) AS files_removed,
  SUM(fc.files_renamed) AS files_renamed
FROM
  pr_base pb
  LEFT JOIN file_counts fc ON pb.pull_request_id = fc.pull_request_id
GROUP BY
  pb.merge_date
ORDER BY
  pb.merge_date DESC;
`;

export const getUserStats = `
WITH issue_stats AS (
  SELECT
    COUNT(CASE WHEN i.issue_type_id = 1 THEN 1 END) as issue_count,
    COUNT(CASE WHEN i.issue_type_id = 2 THEN 1 END) as pull_request_count,
    COUNT(CASE WHEN i.issue_type_id = 2 AND pr.merged_at IS NOT NULL THEN 1 END) as merged_pull_count,
    COUNT(CASE WHEN i.issue_type_id = 2 AND i.state = 'open' THEN 1 END) as open_pull_count
  FROM
    issue i
    LEFT JOIN pull_request pr ON i.issue_id = pr.issue_id
    JOIN "user" u ON i.user_id = u.user_id
  WHERE
    i.repository_id = $1
    AND u.gh_login = $2
),
user_activity_info AS (
  SELECT
    ua.first_seen_timestamp,
    ua.last_seen_timestamp
  FROM
    user_activity ua
    JOIN "user" u USING (user_id)
  WHERE
    ua.repository_id = $1
    AND u.gh_login = $2
),
total_users_count AS (
  SELECT COUNT(*) as total_users
  FROM user_activity
  WHERE repository_id = $1
),
user_position AS (
  SELECT
    COUNT(*) FILTER (WHERE ranked.first_seen_timestamp <= target.first_seen_timestamp) as position
  FROM
    user_activity ranked,
    (SELECT ua.first_seen_timestamp
     FROM user_activity ua
     JOIN "user" u USING (user_id)
     WHERE ua.repository_id = $1 AND u.gh_login = $2) target
  WHERE
    ranked.repository_id = $1
)
SELECT
  s.issue_count,
  s.pull_request_count,
  s.merged_pull_count,
  s.open_pull_count,
  a.first_seen_timestamp,
  a.last_seen_timestamp,
  COALESCE(p.position, 0) as user_position,
  t.total_users as total_unique_users
FROM
  issue_stats s
  LEFT JOIN user_activity_info a ON true
  LEFT JOIN user_position p ON true
  CROSS JOIN total_users_count t;
`;

export const getRecentPulls = `
WITH TopPullRequests AS (
    SELECT
        i.issue_id,
        pr.pull_request_id,
        i.created_at,
        i.user_id AS author_user_id
    FROM
        "user" u
        JOIN issue i ON u.user_id = i.user_id
        LEFT JOIN pull_request pr ON i.issue_id = pr.issue_id
    WHERE
        i.repository_id = $1
        AND u.gh_login = $2
        AND i.issue_type_id = 2
    ORDER BY
        i.created_at DESC
    LIMIT $3
    OFFSET $4
),
all_interactions AS (
    SELECT
        prc.pull_request_id,
        prc.user_id,
        tpr.author_user_id AS author_id,
        prc.created_at AS interaction_time,
        u.gh_login,
        'comment' AS interaction_type
    FROM
        pull_request_comment prc
        JOIN TopPullRequests tpr ON prc.pull_request_id = tpr.pull_request_id
        JOIN "user" u ON prc.user_id = u.user_id
UNION ALL
SELECT
    tpr.pull_request_id,
    ic.user_id,
    tpr.author_user_id AS author_id,
    ic.created_at,
    u.gh_login,
    'comment'
FROM
    issue_comment ic
    JOIN issue i ON i.issue_id = ic.issue_id
    JOIN TopPullRequests tpr ON i.issue_id = tpr.issue_id
    JOIN "user" u ON ic.user_id = u.user_id
UNION ALL
-- Pull request reviews (only for actual PRs)
SELECT
    prr.pull_request_id,
    prr.user_id,
    tpr.author_user_id AS author_id,
    prr.submitted_at,
    u.gh_login,
    CASE WHEN prr.body <> '' THEN
        'comment'
    ELSE
        'review_only'
    END
FROM
    pull_request_review prr
    JOIN TopPullRequests tpr ON prr.pull_request_id = tpr.pull_request_id
    JOIN "user" u ON prr.user_id = u.user_id
),
comment_counts AS (
    SELECT
        pull_request_id, -- This can now be NULL for issues that are not pull requests
        COUNT(*) FILTER (WHERE user_id = author_id
                AND interaction_type = 'comment') AS author_comments,
            COUNT(*) FILTER (WHERE user_id <> author_id
                AND gh_login NOT LIKE '%[bot]%'
                AND interaction_type = 'comment') AS non_author_comments,
        COUNT(*) FILTER (WHERE user_id <> author_id
            AND gh_login LIKE '%[bot]%'
            AND interaction_type = 'comment') AS bot_comments
    FROM
        all_interactions
GROUP BY
    pull_request_id
)
SELECT
    i.gh_issue_id,
    i.title,
    i.created_at,
    i.closed_at,
    CASE WHEN pr.merged_at IS NOT NULL THEN
        'merged'
    WHEN i.state = 'closed' THEN
        'closed'
    ELSE
        'open'
    END AS status,
    pr.additions,
    pr.deletions,
    pr.changed_files,
    COALESCE(pres.rounds_of_review, prrr.rounds, 0) AS rounds_of_review,
    COALESCE(pres.bot_rounds_of_review, 0) AS bot_rounds_of_review,
    COALESCE(cc.author_comments, 0) AS author_comments,
    COALESCE(cc.non_author_comments, 0) AS non_author_comments,
    COALESCE(cc.bot_comments, 0) AS bot_comments,
    pres.first_review_at AS first_review_time,
    pres.first_effective_approval_at AS first_approval_time
FROM
    TopPullRequests tpr
    JOIN issue i ON tpr.issue_id = i.issue_id
    LEFT JOIN pull_request pr ON tpr.pull_request_id = pr.pull_request_id
    LEFT JOIN pull_request_enhanced_stats pres ON pr.pull_request_id = pres.pull_request_id
    LEFT JOIN pull_request_round_of_review prrr ON pr.pull_request_id = prrr.pull_request_id
    LEFT JOIN comment_counts cc ON tpr.pull_request_id = cc.pull_request_id
ORDER BY
    i.created_at DESC;
`;

export const getOpenPullRequestsToSkip = `
SELECT
    gh_issue_id
FROM
    issue
LEFT JOIN
    pull_request pr USING (issue_id)
JOIN
    "user" USING (user_id)
WHERE
    repository_id = $1
    AND gh_login = $2
    AND (state = 'open' AND created_at > $3)
`;

export const getAllProcessedPullRequests = `
SELECT
    gh_issue_id
FROM
    issue
LEFT JOIN
    pull_request pr USING (issue_id)
JOIN
    "user" USING (user_id)
WHERE
    repository_id = $1
    AND gh_login = $2
    AND closed_at IS NOT NULL
`;

export const getUserActivity = `
SELECT
    user_id,
    first_seen_issue_id,
    first_seen_timestamp,
    first_seen_activity_type,
    last_seen_issue_id,
    last_seen_timestamp,
    last_seen_activity_type
FROM
    user_activity
WHERE
    repository_id = $1
`;

// TODO: Clean this up, it shouldn't be left around, bug elsewhere?
export const dropTempUserActivityTable = (sql: Sql) =>
  sql`
  DROP TABLE temp_user_activity
`;

export const createTempUserActivityTable = (sql: Sql) =>
  sql`
  CREATE TEMP TABLE temp_user_activity (
    user_id integer,
    repository_id integer,
    issue_id integer,
    activity_timestamp TIMESTAMP,
    activity_type text
  )
`;

export const populateTempUserActivity = (sql: Sql, repositoryId: number) =>
  sql`
INSERT INTO temp_user_activity (user_id, repository_id, issue_id, activity_timestamp, activity_type)
SELECT
    i.user_id,
    i.repository_id,
    i.issue_id,
    i.created_at,
    'issue'
FROM
    issue i
    INNER JOIN pull_request pr ON pr.issue_id = i.issue_id
WHERE
    i.repository_id = ${repositoryId}
    AND i.issue_type_id = 2
    AND pr.merged_at IS NOT NULL
UNION ALL
SELECT
    prc.user_id,
    i.repository_id,
    i.issue_id,
    prc.created_at,
    'comment'
FROM
    pull_request_comment prc
    INNER JOIN pull_request pr ON pr.pull_request_id = prc.pull_request_id
    INNER JOIN issue i ON i.issue_id = pr.issue_id
WHERE
    i.repository_id = ${repositoryId}
    AND i.issue_type_id = 2
    AND pr.merged_at IS NOT NULL
UNION ALL
SELECT
    ic.user_id,
    i.repository_id,
    i.issue_id,
    ic.created_at,
    'comment'
FROM
    issue_comment ic
    INNER JOIN issue i ON i.issue_id = ic.issue_id
    INNER JOIN pull_request pr ON pr.issue_id = i.issue_id
WHERE
    i.repository_id = ${repositoryId}
    AND i.issue_type_id = 2
    AND pr.merged_at IS NOT NULL
UNION ALL
SELECT
    prr.user_id,
    i.repository_id,
    i.issue_id,
    prr.submitted_at,
    'review'
FROM
    pull_request_review prr
    INNER JOIN pull_request pr ON pr.pull_request_id = prr.pull_request_id
    INNER JOIN issue i ON i.issue_id = pr.issue_id
WHERE
    i.repository_id = ${repositoryId}
    AND i.issue_type_id = 2
    AND pr.merged_at IS NOT NULL

`;

export const indexTempUserActivity = (sql: Sql) =>
  sql`
  CREATE INDEX ON temp_user_activity (user_id, repository_id, activity_timestamp)
`;

export const deleteOldUserActivity = (sql: Sql, repositoryId: number) =>
  sql`
  DELETE FROM user_activity WHERE repository_id = ${repositoryId}
`;

export const insertNewUserActivity = (sql: Sql) =>
  sql`
WITH first_activity AS (
    SELECT DISTINCT ON (user_id,
        repository_id)
        user_id,
        repository_id,
        issue_id AS first_seen_issue_id,
        activity_type AS first_seen_activity_type,
        activity_timestamp AS first_seen_timestamp
    FROM
        temp_user_activity
    WHERE
        activity_timestamp IS NOT NULL
    ORDER BY
        user_id,
        repository_id,
        activity_timestamp ASC,
        issue_id ASC,
        activity_type ASC
),
last_activity AS (
    SELECT DISTINCT ON (user_id,
        repository_id)
        user_id,
        repository_id,
        issue_id AS last_seen_issue_id,
        activity_type AS last_seen_activity_type,
        activity_timestamp AS last_seen_timestamp
    FROM
        temp_user_activity
    WHERE
        activity_timestamp IS NOT NULL
    ORDER BY
        user_id,
        repository_id,
        activity_timestamp DESC,
        issue_id DESC,
        activity_type DESC)
INSERT INTO user_activity (user_id, repository_id, first_seen_issue_id, last_seen_issue_id, first_seen_timestamp, last_seen_timestamp, first_seen_activity_type, last_seen_activity_type, inserted_at)
SELECT
    f.user_id,
    f.repository_id,
    f.first_seen_issue_id,
    l.last_seen_issue_id,
    f.first_seen_timestamp,
    l.last_seen_timestamp,
    f.first_seen_activity_type,
    l.last_seen_activity_type,
    CURRENT_TIMESTAMP
FROM
    first_activity f
    JOIN last_activity l ON f.user_id = l.user_id
        AND f.repository_id = l.repository_id`;

export const getUserIssueReviews = (
  sql: Sql,
  userId: number,
  repositoryId: number,
  limit: number,
  offset: number,
) =>
  sql`
WITH
-- 1. Find all actions by the user (filter early for efficiency)
user_actions AS (
    -- Top-level comments (issue_comment)
    SELECT
        pr.pull_request_id,
        ic.created_at AS action_time,
        i.issue_id,
        i.user_id AS author_user_id
    FROM
        public.issue_comment ic
        JOIN public.issue i ON ic.issue_id = i.issue_id
        JOIN public.pull_request pr ON i.issue_id = pr.issue_id
    WHERE
        ic.user_id = ${userId} -- User of interest
        AND i.repository_id = ${repositoryId} -- Input: repository_id
        AND i.user_id != ${userId} -- Not authored by user
    UNION ALL
    -- Inline comments (pull_request_comment)
    SELECT
        pr.pull_request_id,
        prc.created_at AS action_time,
        i.issue_id,
        i.user_id AS author_user_id
    FROM
        public.pull_request_comment prc
        JOIN public.pull_request pr ON prc.pull_request_id = pr.pull_request_id
        JOIN public.issue i ON pr.issue_id = i.issue_id
    WHERE
        prc.user_id = ${userId}
        AND i.repository_id = ${repositoryId}
        AND i.user_id != ${userId}
    UNION ALL
    -- Formal reviews (pull_request_review) - only submitted to match all_interactions
    SELECT
        pr.pull_request_id,
        prr.submitted_at AS action_time,
        i.issue_id,
        i.user_id AS author_user_id
    FROM
        public.pull_request_review prr
        JOIN public.pull_request pr ON prr.pull_request_id = pr.pull_request_id
        JOIN public.issue i ON pr.issue_id = i.issue_id
    WHERE
        prr.user_id = ${userId}
        AND i.repository_id = ${repositoryId}
        AND i.user_id != ${userId}
        AND prr.submitted_at IS NOT NULL -- Only submitted reviews
),
-- Aggregate to get unique PRs with latest action time, ordered by recency
reviewed_prs AS (
    SELECT
        pull_request_id,
        issue_id,
        author_user_id,
        MAX(action_time) AS latest_action_by_user
    FROM
        user_actions
    GROUP BY
        pull_request_id,
        issue_id,
        author_user_id
    ORDER BY
        latest_action_by_user DESC
    LIMIT ${limit}
    OFFSET ${offset}
),
-- 2. Gather all interactions for these PRs (now small, only limited PRs) - for comment counts (excludes reviews without body)
all_interactions AS (
    -- Top-level PR comments (from issue_comment)
    SELECT
        rpr.pull_request_id,
        ic.user_id,
        u.gh_login,
        rpr.author_user_id,
        ic.created_at AS interaction_time
    FROM
        reviewed_prs rpr
        JOIN public.issue_comment ic ON ic.issue_id = rpr.issue_id
        JOIN public."user" u ON ic.user_id = u.user_id
UNION ALL
-- Inline code comments (from pull_request_comment)
SELECT
    rpr.pull_request_id,
    prc.user_id,
    u.gh_login,
    rpr.author_user_id,
    prc.created_at
FROM
    reviewed_prs rpr
    JOIN public.pull_request_comment prc ON prc.pull_request_id = rpr.pull_request_id
    JOIN public."user" u ON prc.user_id = u.user_id
UNION ALL
-- Formal review submission comments (from pull_request_review)
SELECT
    rpr.pull_request_id,
    prr.user_id,
    u.gh_login,
    rpr.author_user_id,
    prr.submitted_at
FROM
    reviewed_prs rpr
    JOIN public.pull_request_review prr ON prr.pull_request_id = rpr.pull_request_id
    JOIN public."user" u ON prr.user_id = u.user_id
    WHERE
        prr.body IS NOT NULL
        AND prr.body <> ''
        AND prr.submitted_at IS NOT NULL
),
-- NEW: All review actions (includes formal reviews even without body) - for accurate first review times
all_review_actions AS (
    -- Top-level comments
    SELECT
        rpr.pull_request_id,
        ic.created_at AS action_time,
        ic.user_id,
        u.gh_login,
        rpr.author_user_id
    FROM
        reviewed_prs rpr
        JOIN public.issue_comment ic ON ic.issue_id = rpr.issue_id
        JOIN public."user" u ON ic.user_id = u.user_id
UNION ALL
-- Inline comments
SELECT
    rpr.pull_request_id,
    prc.created_at,
    prc.user_id,
    u.gh_login,
    rpr.author_user_id
FROM
    reviewed_prs rpr
    JOIN public.pull_request_comment prc ON prc.pull_request_id = rpr.pull_request_id
    JOIN public."user" u ON prc.user_id = u.user_id
UNION ALL
-- Formal reviews (all submitted, even without body)
SELECT
    rpr.pull_request_id,
    prr.submitted_at,
    prr.user_id,
    u.gh_login,
    rpr.author_user_id
FROM
    reviewed_prs rpr
    JOIN public.pull_request_review prr ON prr.pull_request_id = rpr.pull_request_id
    JOIN public."user" u ON prr.user_id = u.user_id
    WHERE
        prr.submitted_at IS NOT NULL
),
-- 3. Calculate the new requested comment count breakdown
comment_counts AS (
    SELECT
        pull_request_id,
        COUNT(*) FILTER (WHERE user_id = author_user_id) AS author_comments,
        COUNT(*) FILTER (WHERE user_id = ${userId}) AS user_of_interest_comments,
            COUNT(*) FILTER (WHERE user_id != author_user_id
                AND user_id != ${userId}
                AND gh_login NOT LIKE '%[bot]%') AS other_user_comments,
            COUNT(*) FILTER (WHERE gh_login LIKE '%[bot]%') AS bot_comments FROM all_interactions
        GROUP BY
            pull_request_id),
        -- 4. Calculate stats specific to the user-of-interest's contribution (now based on user_actions to include reviews without body)
        user_review_stats AS (
            SELECT
                pull_request_id,
                MIN(action_time) AS first_interaction_time,
                -- Get the user's latest formal review state (e.g., 'APPROVED')
                (
                    SELECT
                        state
                    FROM public.pull_request_review
                    WHERE
                        pull_request_id = ua.pull_request_id
                        AND user_id = ${userId}
                        AND submitted_at IS NOT NULL ORDER BY submitted_at DESC LIMIT 1) AS latest_review_state
            FROM
                user_actions ua
            GROUP BY
                pull_request_id),
            -- 5. Determine the absolute first review time for each PR to see if our user was first (now includes reviews without body)
            first_review_info AS (
                SELECT
                    pull_request_id,
                    MIN(action_time) AS first_overall_review_time
                FROM
                    all_review_actions
                WHERE
                    user_id != author_user_id
                    AND gh_login NOT LIKE '%[bot]%'
                GROUP BY
                    pull_request_id)
                -- Final SELECT to assemble the report
                SELECT
                    i.gh_issue_id,
                    i.title,
                    author.gh_login AS author_login,
                    i.created_at,
                    -- PR Size & Status
                    CASE WHEN pr.merged_at IS NOT NULL THEN
                        'Merged'
                    WHEN i.state = 'closed' THEN
                        'Closed'
                    ELSE
                        'Open'
                    END AS status,
                    pr.additions,
                    pr.deletions,
                    pr.changed_files,
                    COALESCE(prrr.rounds, 0) AS rounds_of_review,
                    -- User's Specific Contribution
                    CASE WHEN urs.latest_review_state = 'APPROVED' THEN
                        'approved'
                    WHEN urs.latest_review_state = 'CHANGES_REQUESTED' THEN
                        'requested_changes'
                    WHEN urs.latest_review_state = 'DISMISSED' THEN
                        'dismissed'
                    ELSE
                        'commented'
                    END AS review_status,
                    (urs.first_interaction_time = fri.first_overall_review_time) AS was_first_reviewer,
                    EXTRACT(EPOCH FROM (urs.first_interaction_time - i.created_at)) / 3600 AS time_to_first_review,
                    -- Comment Breakdown
                    COALESCE(cc.author_comments, 0) AS author_comments,
                    COALESCE(cc.user_of_interest_comments, 0) AS reviewer_comments,
                    COALESCE(cc.other_user_comments, 0) AS other_user_comments,
                    COALESCE(cc.bot_comments, 0) AS bot_comments
                FROM
                    reviewed_prs rpr
                    JOIN public.issue i ON rpr.issue_id = i.issue_id
                    JOIN public.pull_request pr ON rpr.pull_request_id = pr.pull_request_id
                    JOIN public."user" author ON rpr.author_user_id = author.user_id
                    LEFT JOIN public.pull_request_round_of_review prrr ON rpr.pull_request_id = prrr.pull_request_id
                    LEFT JOIN comment_counts cc ON rpr.pull_request_id = cc.pull_request_id
                    LEFT JOIN user_review_stats urs ON rpr.pull_request_id = urs.pull_request_id
                    LEFT JOIN first_review_info fri ON rpr.pull_request_id = fri.pull_request_id
                ORDER BY
                    rpr.latest_action_by_user DESC
`;

export const getRenamedFilesForBackfill = `
SELECT 
    u.gh_login, 
    i.title, 
    i.created_at, 
    i.gh_issue_id, 
    prf.pull_request_file_id,
    prf.filename,
    prf.status
FROM "user" u 
JOIN issue i USING (user_id)
JOIN pull_request pr USING (issue_id)
JOIN pull_request_file prf USING (pull_request_id)
WHERE i.repository_id = $1 
    AND prf.status = 'renamed'
    AND prf.previous_filename IS NULL
ORDER BY i.created_at DESC 
LIMIT $2;
`;

export const updatePreviousFilename = `
UPDATE pull_request_file 
SET previous_filename = $1 
WHERE pull_request_file_id = $2;
`;

export const getMergedPrTiming = (
  sql: Sql,
  repositoryId: number,
  startDate: Date,
  endDate: Date,
) =>
  sql`
SELECT
    cprm.issue_created_at AS created_at,
    cprm.merged_at,
    EXTRACT(EPOCH FROM (cprm.merged_at - cprm.issue_created_at)) / 3600 AS hours_to_merge
FROM
    computed_pull_request_metrics cprm
WHERE
    cprm.repository_id = ${repositoryId}
    AND cprm.target_branch IN ('main', 'master')
    AND cprm.merged_at IS NOT NULL
    AND cprm.merged_at > ${startDate.toISOString()}
    AND cprm.merged_at <= ${endDate.toISOString()}
ORDER BY
    cprm.merged_at DESC
`;

export const updateRepositoryOverview = (sql: Sql, repositoryId: number) =>
  sql`
    WITH all_pr_participants AS (
         -- PR authors (merged PRs only)
         SELECT i.user_id
         FROM issue i
         JOIN pull_request pr ON i.issue_id = pr.issue_id
         WHERE i.repository_id = ${repositoryId} AND i.issue_type_id = 2
           AND pr.merged_at IS NOT NULL
         UNION
         -- PR reviewers (merged PRs only)
         SELECT prr.user_id
         FROM pull_request_review prr
         JOIN pull_request pr ON prr.pull_request_id = pr.pull_request_id
         JOIN issue i ON pr.issue_id = i.issue_id
         WHERE i.repository_id = ${repositoryId} AND i.issue_type_id = 2
           AND pr.merged_at IS NOT NULL
         UNION
         -- PR commenters (inline comments, merged PRs only)
         SELECT prc.user_id
         FROM pull_request_comment prc
         JOIN pull_request pr ON prc.pull_request_id = pr.pull_request_id
         JOIN issue i ON pr.issue_id = i.issue_id
         WHERE i.repository_id = ${repositoryId} AND i.issue_type_id = 2
           AND pr.merged_at IS NOT NULL
         UNION
         -- Issue commenters on PRs (merged PRs only)
         SELECT ic.user_id
         FROM issue_comment ic
         JOIN issue i ON ic.issue_id = i.issue_id
         JOIN pull_request pr ON i.issue_id = pr.issue_id
         WHERE i.repository_id = ${repositoryId} AND i.issue_type_id = 2
           AND pr.merged_at IS NOT NULL
      ),
     activity_stats AS (
      SELECT
          -- Filter out bogus 1970 timestamps from bad data imports
          MIN(created_at) FILTER (WHERE created_at > '1975-01-01'::timestamptz) AS first_activity,
          MAX(updated_at) FILTER (WHERE updated_at > '1975-01-01'::timestamptz) AS last_activity,
          (SELECT COUNT(DISTINCT user_id) FROM all_pr_participants) AS total_users
      FROM
          issue
      WHERE
          repository_id = ${repositoryId}
          AND issue_type_id = 2
  ),
 active_users AS (
     SELECT
         COUNT(DISTINCT user_id) AS active_users_3mo
     FROM
         user_activity
     WHERE
         repository_id = ${repositoryId}
         AND last_seen_timestamp >= NOW() - INTERVAL '3 months'
 ),
pr_stats AS (
    SELECT
        COUNT(*) FILTER (WHERE pr.merged_at IS NOT NULL) AS merged_prs,
        COUNT(*) FILTER (WHERE i.state = 'open') AS open_prs,
        COUNT(*) FILTER (WHERE i.state = 'closed'
            AND pr.merged_at IS NULL) AS closed_prs,
        COUNT(*) AS total_prs
    FROM
        issue i
        LEFT JOIN pull_request pr ON i.issue_id = pr.issue_id
    WHERE
        i.repository_id = ${repositoryId}
        AND i.issue_type_id = 2 -- Pull request type
),
file_stats AS (
    SELECT
        -- Calculates the net change in files. Renames don't affect the total count.
        GREATEST (0, COUNT(*) FILTER (WHERE prf.status = 'added') - COUNT(*) FILTER (WHERE prf.status = 'removed')) AS estimated_total_files,
        -- Calculates net LOC change by subtracting ALL deletions from ALL additions.
        COALESCE(SUM(prf.additions), 0) - COALESCE(SUM(prf.deletions), 0) AS estimated_total_loc
    FROM
        issue i
        JOIN pull_request pr ON i.issue_id = pr.issue_id
        JOIN pull_request_file prf ON pr.pull_request_id = prf.pull_request_id
    WHERE
        i.repository_id = ${repositoryId}
        AND pr.merged_at IS NOT NULL -- Only count merged PRs
        AND pr.target_branch IN ('master', 'main')
),
file_types AS (
    SELECT
        COALESCE(
            jsonb_agg(jsonb_build_object('extension', extension, 'count', net_file_count)
            ORDER BY net_file_count DESC), '[]'::jsonb) AS top_file_types_by_count
    FROM (
        SELECT
            LOWER(SUBSTRING(prf.filename FROM '\.([^.\/]+)$')) AS extension,
            -- Calculate the net change per extension
            COUNT(*) FILTER (WHERE prf.status = 'added') - COUNT(*) FILTER (WHERE prf.status = 'removed') AS net_file_count
        FROM
            issue i
            JOIN pull_request pr ON i.issue_id = pr.issue_id
            JOIN pull_request_file prf ON pr.pull_request_id = prf.pull_request_id
        WHERE
            i.repository_id = ${repositoryId}
            AND prf.filename ~ '\.[^.\/]+$' -- Has an extension
            AND pr.merged_at IS NOT NULL
            AND pr.target_branch IN ('master', 'main')
        GROUP BY
            extension
        ORDER BY
            net_file_count DESC
        LIMIT 10
    ) ext_counts
),
file_types_by_loc AS (
    SELECT
        COALESCE(
            jsonb_agg(jsonb_build_object('extension', extension, 'loc', net_loc)
            ORDER BY net_loc DESC), '[]'::jsonb) AS top_file_types_by_loc
    FROM (
        SELECT
            LOWER(SUBSTRING(prf.filename FROM '\.([^.\/]+)$')) AS extension,
            -- The net change in LOC is additions minus deletions for all statuses
            SUM(prf.additions - prf.deletions) AS net_loc
        FROM
            issue i
            JOIN pull_request pr ON i.issue_id = pr.issue_id
            JOIN pull_request_file prf ON pr.pull_request_id = prf.pull_request_id
        WHERE
            i.repository_id = ${repositoryId}
            AND prf.filename ~ '\.[^.\/]+$' -- Has an extension
            AND pr.merged_at IS NOT NULL
            AND pr.target_branch IN ('master', 'main')
        GROUP BY
            extension
        ORDER BY
            net_loc DESC
        LIMIT 10) loc_counts
),
median_author_age_3mo AS (
    SELECT
        percentile_cont(0.5) WITHIN GROUP (ORDER BY cprm.contributor_age_days) AS median_author_age_3mo_days
    FROM
        issue i
        JOIN pull_request pr ON i.issue_id = pr.issue_id
        JOIN computed_pull_request_metrics cprm ON cprm.pull_request_id = pr.pull_request_id
    WHERE
        i.repository_id = ${repositoryId}
        AND i.issue_type_id = 2
        AND pr.merged_at IS NOT NULL
        AND pr.merged_at >= NOW() - INTERVAL '3 months'
        AND cprm.contributor_age_days IS NOT NULL
)
    INSERT INTO computed_repository_overview (repository_id, first_activity, last_activity, total_users, active_users_3mo, merged_prs, open_prs, closed_prs, total_prs, estimated_total_files, estimated_total_loc, top_file_types_by_count, top_file_types_by_loc, median_author_age_3mo_days)
    SELECT
        ${repositoryId},
        a.first_activity,
        a.last_activity,
        a.total_users,
        au.active_users_3mo,
        p.merged_prs,
        p.open_prs,
        p.closed_prs,
        p.total_prs,
        f.estimated_total_files,
        f.estimated_total_loc,
        ft.top_file_types_by_count,
        fl.top_file_types_by_loc,
        ma.median_author_age_3mo_days
    FROM
        activity_stats a
    CROSS JOIN active_users au
    CROSS JOIN pr_stats p
    CROSS JOIN file_stats f
    CROSS JOIN file_types ft
    CROSS JOIN file_types_by_loc fl
    CROSS JOIN median_author_age_3mo ma
ON CONFLICT (repository_id)
    DO UPDATE SET
        first_activity = EXCLUDED.first_activity,
        last_activity = EXCLUDED.last_activity,
        total_users = EXCLUDED.total_users,
        active_users_3mo = EXCLUDED.active_users_3mo,
        merged_prs = EXCLUDED.merged_prs,
        open_prs = EXCLUDED.open_prs,
        closed_prs = EXCLUDED.closed_prs,
        total_prs = EXCLUDED.total_prs,
        estimated_total_files = EXCLUDED.estimated_total_files,
        estimated_total_loc = EXCLUDED.estimated_total_loc,
        top_file_types_by_count = EXCLUDED.top_file_types_by_count,
        top_file_types_by_loc = EXCLUDED.top_file_types_by_loc,
        median_author_age_3mo_days = EXCLUDED.median_author_age_3mo_days,
        computed_at = CURRENT_TIMESTAMP;
  `;

export const getRepositoryOverview = (sql: Sql, repositoryId: number) =>
  sql`
SELECT
    repository_id,
    first_activity,
    last_activity,
    total_users,
    active_users_3mo,
    merged_prs,
    open_prs,
    closed_prs,
    total_prs,
    estimated_total_files,
    estimated_total_loc,
    top_file_types_by_count,
    top_file_types_by_loc,
    median_author_age_3mo_days,
    computed_at
FROM
    computed_repository_overview
WHERE
    repository_id = ${repositoryId};
  `;

// Filesystem persistence queries
export const deleteOldFileSystem = (sql: Sql, repositoryId: number) =>
  sql`DELETE FROM computed_filesystem WHERE repository_id = ${repositoryId}`;

export const insertFileSystemNodes = (
  sql: Sql,
  nodes: ComputedFileSystemNode[],
) => {
  if (nodes.length === 0) return Promise.resolve();

  const BATCH_SIZE = 10000;
  const batches = [];

  // Split nodes into batches
  for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
    batches.push(nodes.slice(i, i + BATCH_SIZE));
  }

  // Process each batch
  const batchPromises = batches.map((batch) => {
    // Build VALUES clause with placeholders
    const values = batch.flatMap((node) => [
      node.repository_id,
      node.path,
      node.parent_path,
      node.level,
      node.node_data,
    ]);

    // Create parameter placeholders: ($1,$2,$3,$4,$5), ($6,$7,$8,$9,$10), ...
    const placeholders = batch
      .map((_, index) => {
        const base = index * 5;
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${
          base + 5
        })`;
      })
      .join(",");

    const query = `
      INSERT INTO computed_filesystem (repository_id, path, parent_path, level, node_data)
      VALUES ${placeholders}
    `;

    return sql.unsafe(query, values);
  });

  return Promise.all(batchPromises);
};

// ---------------------------------------------------------------------------
// User monthly metrics (computed on-the-fly)
// ---------------------------------------------------------------------------

export const getUserMonthlyMergedPrs = `
SELECT
  date_trunc('month', pr.merged_at)::date AS month,
  COUNT(*)::bigint AS value
FROM issue i
INNER JOIN "user" u ON u.user_id = i.user_id
INNER JOIN pull_request pr ON pr.issue_id = i.issue_id
WHERE i.repository_id = $1
  AND u.gh_login = $2
  AND i.issue_type_id = 2
  AND pr.merged_at IS NOT NULL
  AND LOWER(pr.target_branch) IN ('main', 'master')
GROUP BY 1
ORDER BY 1
`;

export const getUserMonthlyLinesModified = `
SELECT
  date_trunc('month', pr.merged_at)::date AS month,
  SUM(pr.additions + pr.deletions)::bigint AS value
FROM issue i
INNER JOIN "user" u ON u.user_id = i.user_id
INNER JOIN pull_request pr ON pr.issue_id = i.issue_id
WHERE i.repository_id = $1
  AND u.gh_login = $2
  AND i.issue_type_id = 2
  AND pr.merged_at IS NOT NULL
  AND LOWER(pr.target_branch) IN ('main', 'master')
GROUP BY 1
ORDER BY 1
`;

export const getUserMonthlyPrsReviewed = (
  sql: Sql,
  repositoryId: number,
  ghLogin: string,
) =>
  sql`
    WITH review_interactions AS (
      SELECT
        pr.pull_request_id,
        prr.submitted_at AS interaction_time
      FROM pull_request_review prr
      INNER JOIN pull_request pr ON pr.pull_request_id = prr.pull_request_id
      INNER JOIN issue i ON i.issue_id = pr.issue_id
      INNER JOIN "user" u ON u.user_id = prr.user_id
      WHERE i.repository_id = ${repositoryId}
        AND i.issue_type_id = 2
        AND pr.merged_at IS NOT NULL
        AND LOWER(pr.target_branch) IN ('main', 'master')
        AND u.gh_login = ${ghLogin}
        AND prr.user_id <> i.user_id
        AND (prr.body <> '' OR prr.state = 'APPROVED')

      UNION ALL

      SELECT
        pr.pull_request_id,
        prc.created_at AS interaction_time
      FROM pull_request_comment prc
      INNER JOIN pull_request pr ON pr.pull_request_id = prc.pull_request_id
      INNER JOIN issue i ON i.issue_id = pr.issue_id
      INNER JOIN "user" u ON u.user_id = prc.user_id
      WHERE i.repository_id = ${repositoryId}
        AND i.issue_type_id = 2
        AND pr.merged_at IS NOT NULL
        AND LOWER(pr.target_branch) IN ('main', 'master')
        AND u.gh_login = ${ghLogin}
        AND prc.user_id <> i.user_id

      UNION ALL

      SELECT
        pr.pull_request_id,
        ic.created_at AS interaction_time
      FROM issue_comment ic
      INNER JOIN issue i ON i.issue_id = ic.issue_id
      INNER JOIN pull_request pr ON pr.issue_id = i.issue_id
      INNER JOIN "user" u ON u.user_id = ic.user_id
      WHERE i.repository_id = ${repositoryId}
        AND i.issue_type_id = 2
        AND pr.merged_at IS NOT NULL
        AND LOWER(pr.target_branch) IN ('main', 'master')
        AND u.gh_login = ${ghLogin}
        AND ic.user_id <> i.user_id
    ),
    pr_first_review AS (
      SELECT
        pull_request_id,
        date_trunc('month', MIN(interaction_time))::date AS month
      FROM review_interactions
      WHERE interaction_time IS NOT NULL
      GROUP BY pull_request_id
    )
    SELECT month, COUNT(*)::bigint AS value
    FROM pr_first_review
    GROUP BY month
    ORDER BY month
  `;

export const getUserMonthlyPrComments = (
  sql: Sql,
  repositoryId: number,
  ghLogin: string,
) =>
  sql`
    WITH comment_events AS (
      SELECT
        prc.created_at AS interaction_time
      FROM pull_request_comment prc
      INNER JOIN pull_request pr ON pr.pull_request_id = prc.pull_request_id
      INNER JOIN issue i ON i.issue_id = pr.issue_id
      INNER JOIN "user" u ON u.user_id = prc.user_id
      WHERE i.repository_id = ${repositoryId}
        AND i.issue_type_id = 2
        AND pr.merged_at IS NOT NULL
        AND LOWER(pr.target_branch) IN ('main', 'master')
        AND u.gh_login = ${ghLogin}
        AND prc.user_id <> i.user_id

      UNION ALL

      SELECT
        ic.created_at AS interaction_time
      FROM issue_comment ic
      INNER JOIN issue i ON i.issue_id = ic.issue_id
      INNER JOIN pull_request pr ON pr.issue_id = i.issue_id
      INNER JOIN "user" u ON u.user_id = ic.user_id
      WHERE i.repository_id = ${repositoryId}
        AND i.issue_type_id = 2
        AND pr.merged_at IS NOT NULL
        AND LOWER(pr.target_branch) IN ('main', 'master')
        AND u.gh_login = ${ghLogin}
        AND ic.user_id <> i.user_id

      UNION ALL

      SELECT
        prr.submitted_at AS interaction_time
      FROM pull_request_review prr
      INNER JOIN pull_request pr ON pr.pull_request_id = prr.pull_request_id
      INNER JOIN issue i ON i.issue_id = pr.issue_id
      INNER JOIN "user" u ON u.user_id = prr.user_id
      WHERE i.repository_id = ${repositoryId}
        AND i.issue_type_id = 2
        AND pr.merged_at IS NOT NULL
        AND LOWER(pr.target_branch) IN ('main', 'master')
        AND u.gh_login = ${ghLogin}
        AND prr.user_id <> i.user_id
        AND prr.body <> ''
    )
    SELECT
      date_trunc('month', interaction_time)::date AS month,
      COUNT(*)::bigint AS value
    FROM comment_events
    WHERE interaction_time IS NOT NULL
    GROUP BY 1
    ORDER BY 1
  `;

/**
 * Fetches a single filesystem node by exact path.
 * Uses the unique index on (repository_id, path) for O(1) lookup.
 */
export const getFileSystemNodeByPath = (
  sql: Sql,
  repositoryId: number,
  path: string,
) =>
  sql`
  SELECT repository_id, path, parent_path, level, node_data
  FROM computed_filesystem
  WHERE repository_id = ${repositoryId}
    AND path = ${path}
`;

export const getFileSystemNodes = (
  sql: Sql,
  repositoryId: number,
  parentPath: string,
  levels: number[],
) =>
  sql`
  SELECT repository_id, path, parent_path, level, node_data
  FROM computed_filesystem
  WHERE repository_id = ${repositoryId}
    ${parentPath !== "" ? sql`AND parent_path = ${parentPath}` : sql``}
    ${levels.length > 0 ? sql`AND level = ANY(${levels})` : sql``}
  ORDER BY path
`;

/**
 * Fetches distinct PRs that touch a filesystem path.
 * For folders: matches files under the path prefix (LIKE 'path/%').
 * For files: matches the exact filename.
 *
 * Ordered by i.created_at DESC (not pr.merged_at) to leverage the existing
 * idx_issue_repository_id_created_at index. The pull_request table has no
 * index on merged_at, so sorting by it causes a full seq scan. See the
 * detailed comment on fileSystemService.getFileSystemPRs for the rationale.
 */
export const getFileSystemPRs = (
  sql: Sql,
  repositoryId: number,
  path: string,
  type: "file" | "folder",
  limit: number,
  offset: number,
) =>
  sql`
  SELECT DISTINCT
    i.gh_issue_id,
    i.title,
    u.gh_login,
    i.created_at,
    pr.merged_at,
    pr.additions,
    pr.deletions,
    pr.changed_files,
    pr.comment_count + pr.review_comment_count AS comments
  FROM pull_request_file prf
  JOIN pull_request pr ON pr.pull_request_id = prf.pull_request_id
  JOIN issue i ON i.issue_id = pr.issue_id AND i.repository_id = ${repositoryId}
  JOIN "user" u ON u.user_id = i.user_id
  WHERE ${
    type === "folder"
      ? sql`prf.filename LIKE ${path + "/%"}`
      : sql`prf.filename = ${path}`
  }
    AND pr.merged_at IS NOT NULL
    AND LOWER(pr.target_branch) IN ('main', 'master')
  ORDER BY i.created_at DESC
  LIMIT ${limit}
  OFFSET ${offset}
`;
