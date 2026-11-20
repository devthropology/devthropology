WITH filtered_issues AS (
    SELECT
        i.issue_id,
        i.gh_issue_id,
        i.created_at AS issue_created_at,
        i.user_id AS issue_author_id,
        i.repository_id
    FROM
        issue i
    WHERE
        i.repository_id = 1
        AND i.created_at >= '2020-01-01'
        AND i.created_at < '2024-01-01'
),
reviews_and_comments AS (
    SELECT
        fi.gh_issue_id,
        prr.pull_request_id,
        prr.user_id AS reviewer_id,
        prr.submitted_at AS action_time,
        pr.issue_id,
        fi.issue_created_at,
        fi.issue_author_id
    FROM
        pull_request_review prr
        INNER JOIN pull_request pr ON pr.pull_request_id = prr.pull_request_id
        INNER JOIN filtered_issues fi ON pr.issue_id = fi.issue_id
    WHERE
        fi.issue_author_id <> prr.user_id
        AND (prr.body <> '' OR prr.state = 'APPROVED')
    UNION ALL
    SELECT
        fi.gh_issue_id,
        prc.pull_request_id,
        prc.user_id AS reviewer_id,
        prc.created_at AS action_time,
        pr.issue_id,
        fi.issue_created_at,
        fi.issue_author_id
    FROM
        pull_request_comment prc
        INNER JOIN pull_request pr ON pr.pull_request_id = prc.pull_request_id
        INNER JOIN filtered_issues fi ON pr.issue_id = fi.issue_id
    WHERE
        fi.issue_author_id <> prc.user_id
    UNION ALL
    SELECT
        fi.gh_issue_id,
        pr.pull_request_id,
        ic.user_id AS reviewer_id,
        ic.created_at AS action_time,
        pr.issue_id,
        fi.issue_created_at,
        fi.issue_author_id
    FROM
        issue_comment ic
        join issue i on i.issue_id = ic.issue_id
        join pull_request pr on pr.issue_id = i.issue_id
        INNER JOIN filtered_issues fi ON pr.issue_id = fi.issue_id
    WHERE
        fi.issue_author_id <> ic.user_id
),
reviews AS (
    SELECT DISTINCT
        rac.issue_created_at,
        u.gh_login AS reviewer_gh_login,
        rac.pull_request_id,
        rac.reviewer_id
    FROM
        reviews_and_comments rac
        INNER JOIN USER u ON u.user_id = rac.reviewer_id
),
first_reviews AS (
    SELECT
        rac.gh_issue_id,
        rac.pull_request_id,
        u.gh_login AS reviewer_gh_login,
        rac.issue_created_at,
        MIN(rac.action_time) AS first_review_time
FROM
    reviews_and_comments rac
    INNER JOIN USER u ON u.user_id = rac.reviewer_id
    WHERE
        rac.reviewer_id != rac.issue_author_id
    GROUP BY
        rac.pull_request_id,
        rac.issue_created_at
),
medians AS (
    SELECT
        reviewer_gh_login,
        AVG(delta) AS median_time_in_hours
FROM (
    SELECT
        reviewer_gh_login,
        (julianday (first_review_time) - julianday (issue_created_at)) * 24 AS delta,
        COUNT(*) OVER (PARTITION BY reviewer_gh_login) AS cnt,
    ROW_NUMBER() OVER (PARTITION BY reviewer_gh_login ORDER BY (julianday (first_review_time) - julianday (issue_created_at)) * 24) AS rn
FROM
    first_reviews)
WHERE
    rn IN ((cnt + 1) / 2, (cnt + 2) / 2)
GROUP BY
    reviewer_gh_login
),
averages AS (
    SELECT
        reviewer_gh_login,
        AVG((julianday (first_review_time) - julianday (issue_created_at)) * 24) AS average_time_in_hours
    FROM
        first_reviews
    GROUP BY
        reviewer_gh_login
),
approvals AS (
    SELECT
        u.gh_login AS reviewer_gh_login,
        prr.pull_request_id,
        COUNT(DISTINCT prr.pull_request_review_id) AS approvals
    FROM
        pull_request_review prr
        INNER JOIN USER u ON u.user_id = prr.user_id
    WHERE
        prr.state = 'APPROVED'
    GROUP BY
        prr.pull_request_id,
        reviewer_gh_login
),
non_author_comments AS (
    SELECT
        gh_issue_id,
        u.gh_login AS reviewer_gh_login,
        rac.pull_request_id,
        COUNT(*) AS comments
    FROM
        reviews_and_comments rac
        INNER JOIN USER u ON u.user_id = rac.reviewer_id
    --     INNER JOIN pull_request_comment prc ON prc.pull_request_id = rac.pull_request_id
    --         AND prc.user_id = rac.reviewer_id
    -- WHERE
    --     rac.reviewer_id != rac.issue_author_id
    GROUP BY
        rac.pull_request_id,
        reviewer_gh_login
),
unique_authors AS (
    SELECT
        u.gh_login AS reviewer_gh_login,
        COUNT(DISTINCT i.user_id) AS unique_authors
    FROM
        reviews_and_comments rac
        INNER JOIN USER u ON u.user_id = rac.reviewer_id
        INNER JOIN issue i ON rac.issue_id = i.issue_id
    WHERE
        rac.reviewer_id != rac.issue_author_id
    GROUP BY
        reviewer_gh_login
),
author_interactions AS (
    SELECT
        reviewer_id,
        i.user_id AS pr_author_id,
        COUNT(DISTINCT pull_request_id) AS unique_prs,
        COUNT(*) AS total_interactions
    FROM
        reviews_and_comments rac
        INNER JOIN issue i ON rac.issue_id = i.issue_id
    WHERE
        rac.reviewer_id != i.user_id
    GROUP BY
        reviewer_id,
        pr_author_id
),
most_interacted_authors AS (
    SELECT
        u.gh_login AS pr_author,
        mia.reviewer_id,
        mia.pr_author_id,
        ROW_NUMBER() OVER (PARTITION BY mia.reviewer_id ORDER BY mia.unique_prs DESC) AS rn
    FROM
        author_interactions mia
        INNER JOIN USER u ON mia.pr_author_id = u.user_id
),
most_interacted_authors_comments_left AS (
    SELECT
        u.gh_login AS pr_author,
        mia.reviewer_id,
        mia.pr_author_id,
        ROW_NUMBER() OVER (PARTITION BY mia.reviewer_id ORDER BY mia.total_interactions DESC) AS rn
    FROM
        author_interactions mia
        INNER JOIN USER u ON mia.pr_author_id = u.user_id
),
active_days AS (
    SELECT
        reviewer_id,
        COUNT(DISTINCT DATE(action_time)) AS active_days
    FROM
        reviews_and_comments
    GROUP BY
        reviewer_id
)
SELECT
--    strftime ('%Y-%m', r.issue_created_at) AS review_month,
--    RANK() OVER (PARTITION BY strftime ('%Y-%m', r.issue_created_at) ORDER BY COUNT(DISTINCT r.pull_request_id) DESC) AS rank,
    r.reviewer_gh_login AS reviewer,
    ad.active_days,
    COUNT(DISTINCT r.pull_request_id) AS total_reviews,
    COUNT(DISTINCT fr.pull_request_id) AS first_reviews,
    COUNT(DISTINCT a.pull_request_id) AS approvals,
    SUM(nac.comments) AS non_author_comments,
    ROUND(m.median_time_in_hours, 2) AS median_time_as_first_reviewer,
    ROUND(avg.average_time_in_hours, 2) AS avg_time_as_first_reviewer,
    ua.unique_authors AS unique_authors_interacted_with,
    mia.pr_author AS most_interacted_author,
    miac.pr_author AS most_interacted_author_by_comments
FROM
    reviews r
    LEFT JOIN first_reviews fr ON r.reviewer_gh_login = fr.reviewer_gh_login
        AND r.pull_request_id = fr.pull_request_id
    LEFT JOIN approvals a ON r.reviewer_gh_login = a.reviewer_gh_login
        AND r.pull_request_id = a.pull_request_id
    LEFT JOIN non_author_comments nac ON r.reviewer_gh_login = nac.reviewer_gh_login
        AND r.pull_request_id = nac.pull_request_id
    LEFT JOIN medians m ON r.reviewer_gh_login = m.reviewer_gh_login
    LEFT JOIN averages avg ON r.reviewer_gh_login = avg.reviewer_gh_login
    LEFT JOIN unique_authors ua ON r.reviewer_gh_login = ua.reviewer_gh_login
    LEFT JOIN most_interacted_authors mia ON r.reviewer_id = mia.reviewer_id
        AND mia.rn = 1
    LEFT JOIN most_interacted_authors_comments_left miac ON r.reviewer_id = miac.reviewer_id
        AND miac.rn = 1
    LEFT JOIN active_days ad ON r.reviewer_id = ad.reviewer_id
GROUP BY
    r.reviewer_gh_login
ORDER BY
    total_reviews DESC;

--THIS IS FOR DEBUGGING
-- SELECT
--   *, (julianday(first_review_time) - julianday (issue_created_at)) * 24 AS delta
-- FROM
-- 	first_reviews rc
-- 	where reviewer_gh_login = 'x'
-- 	ORDER BY
-- 		delta DESC;