import postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

function trendsTeamAuthorFilter(sql: Sql, teamSlug?: string) {
  if (!teamSlug) {
    return sql``;
  }

  return sql`
    AND EXISTS (
      SELECT 1
      FROM teams t
      INNER JOIN team_members tm ON tm.team_id = t.team_id
      WHERE t.repository_id = i.repository_id
        AND t.slug = ${teamSlug}
        AND tm.user_id = i.user_id
    )
  `;
}

export const getTrendsReviewRoundsInsights = (
  sql: Sql,
  repositoryId: number,
  teamSlug?: string,
) =>
  sql`
    WITH pr_data AS (
      SELECT
        date_trunc('month', pr.merged_at AT TIME ZONE 'America/New_York')::date AS month,
        COALESCE(pres.rounds_of_review, prror.rounds, 0)::numeric AS review_rounds,
        (
          COALESCE(pres.rounds_of_review, prror.rounds, 0) +
          COALESCE(pres.bot_rounds_of_review, 0)
        )::numeric AS all_review_rounds,
        EXTRACT(EPOCH FROM (pres.first_review_at - i.created_at)) / 3600.0
          AS time_to_first_review_hours,
        EXTRACT(EPOCH FROM (pres.first_effective_approval_at - i.created_at)) /
            3600.0 AS time_to_effective_approval_hours
      FROM issue i
      INNER JOIN pull_request pr ON pr.issue_id = i.issue_id
      INNER JOIN "user" u ON u.user_id = i.user_id
      LEFT JOIN pull_request_round_of_review prror
        ON prror.pull_request_id = pr.pull_request_id
      LEFT JOIN pull_request_enhanced_stats pres
        ON pres.pull_request_id = pr.pull_request_id
      WHERE i.repository_id = ${repositoryId}
        AND i.issue_type_id = 2
        AND pr.merged_at IS NOT NULL
        AND LOWER(pr.target_branch) IN ('main', 'master')
        AND u.gh_login NOT LIKE '%[bot]%'
        ${trendsTeamAuthorFilter(sql, teamSlug)}
    )
    SELECT
      EXTRACT(YEAR FROM month)::integer AS "year",
      EXTRACT(MONTH FROM month)::integer AS "month",
      ROUND(AVG(review_rounds), 2) AS "avgRounds",
      ROUND(AVG(all_review_rounds), 2) AS "avgAllRounds",
      ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY review_rounds))::numeric, 2) AS "p50Rounds",
      ROUND((PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY review_rounds))::numeric, 2) AS "p75Rounds",
      ROUND((PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY review_rounds))::numeric, 2) AS "p90Rounds",
      ROUND((PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY review_rounds))::numeric, 2) AS "p95Rounds",
      ROUND((PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY review_rounds))::numeric, 2) AS "p99Rounds",
      ROUND((100.0 * AVG(CASE WHEN review_rounds = 0 THEN 1 ELSE 0 END))::numeric, 1) AS "pctZeroRounds",
      ROUND((100.0 * AVG(CASE WHEN review_rounds = 1 THEN 1 ELSE 0 END))::numeric, 1) AS "pctOneRound",
      ROUND((100.0 * AVG(CASE WHEN review_rounds = 2 THEN 1 ELSE 0 END))::numeric, 1) AS "pctTwoRounds",
      ROUND((100.0 * AVG(CASE WHEN review_rounds >= 3 THEN 1 ELSE 0 END))::numeric, 1) AS "pctThreePlusRounds",
      ROUND((100.0 * AVG(CASE WHEN review_rounds >= 1 THEN 1 ELSE 0 END))::numeric, 1) AS "pctAnyRound",
      ROUND((100.0 * AVG(CASE WHEN review_rounds >= 2 THEN 1 ELSE 0 END))::numeric, 1) AS "pctTwoPlusRounds",
      ROUND((100.0 * AVG(CASE WHEN all_review_rounds >= 1 THEN 1 ELSE 0 END))::numeric, 1) AS "pctAnyAllRounds",
      ROUND((100.0 * AVG(CASE WHEN all_review_rounds >= 2 THEN 1 ELSE 0 END))::numeric, 1) AS "pctTwoPlusAllRounds",
      ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY time_to_first_review_hours)
        FILTER (WHERE time_to_first_review_hours IS NOT NULL))::numeric, 2) AS "p50TimeToFirstReviewHours",
      ROUND((PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY time_to_first_review_hours)
        FILTER (WHERE time_to_first_review_hours IS NOT NULL))::numeric, 2) AS "p75TimeToFirstReviewHours",
      ROUND((PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY time_to_first_review_hours)
        FILTER (WHERE time_to_first_review_hours IS NOT NULL))::numeric, 2) AS "p90TimeToFirstReviewHours",
      ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY time_to_effective_approval_hours)
        FILTER (WHERE time_to_effective_approval_hours IS NOT NULL))::numeric, 2) AS "p50TimeToEffectiveApprovalHours",
      ROUND((PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY time_to_effective_approval_hours)
        FILTER (WHERE time_to_effective_approval_hours IS NOT NULL))::numeric, 2) AS "p75TimeToEffectiveApprovalHours",
      ROUND((PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY time_to_effective_approval_hours)
        FILTER (WHERE time_to_effective_approval_hours IS NOT NULL))::numeric, 2) AS "p90TimeToEffectiveApprovalHours"
    FROM pr_data
    GROUP BY month
    ORDER BY month
  `;

export const getTrendsPrSizeInsights = (
  sql: Sql,
  repositoryId: number,
  teamSlug?: string,
) =>
  sql`
    WITH pr_data AS (
      SELECT
        date_trunc('month', pr.merged_at AT TIME ZONE 'America/New_York')::date AS month,
        CASE
          WHEN COALESCE(pr.additions, 0) + COALESCE(pr.deletions, 0) <= 10 THEN 'Micro (0-10)'
          WHEN COALESCE(pr.additions, 0) + COALESCE(pr.deletions, 0) <= 75 THEN 'Small (11-75)'
          WHEN COALESCE(pr.additions, 0) + COALESCE(pr.deletions, 0) <= 250 THEN 'Medium (76-250)'
          WHEN COALESCE(pr.additions, 0) + COALESCE(pr.deletions, 0) <= 500 THEN 'Large (251-500)'
          WHEN COALESCE(pr.additions, 0) + COALESCE(pr.deletions, 0) <= 1000 THEN 'XL (501-1000)'
          ELSE 'Oversized (1000+)'
        END AS size_bucket,
        COALESCE(pres.rounds_of_review, prror.rounds, 0)::numeric AS review_rounds,
        (
          COALESCE(pres.rounds_of_review, prror.rounds, 0) +
          COALESCE(pres.bot_rounds_of_review, 0)
        )::numeric AS all_review_rounds,
        EXTRACT(EPOCH FROM (pres.first_review_at - i.created_at)) / 3600.0
          AS time_to_first_review_hours,
        EXTRACT(EPOCH FROM (pres.first_effective_approval_at - i.created_at)) /
            3600.0 AS time_to_effective_approval_hours
      FROM issue i
      INNER JOIN pull_request pr ON pr.issue_id = i.issue_id
      INNER JOIN "user" u ON u.user_id = i.user_id
      LEFT JOIN pull_request_round_of_review prror
        ON prror.pull_request_id = pr.pull_request_id
      LEFT JOIN pull_request_enhanced_stats pres
        ON pres.pull_request_id = pr.pull_request_id
      WHERE i.repository_id = ${repositoryId}
        AND i.issue_type_id = 2
        AND pr.merged_at IS NOT NULL
        AND LOWER(pr.target_branch) IN ('main', 'master')
        AND u.gh_login NOT LIKE '%[bot]%'
        ${trendsTeamAuthorFilter(sql, teamSlug)}
    ),
    bucketed AS (
      SELECT
        month,
        size_bucket,
        COUNT(*)::integer AS prs,
        ROUND(AVG(review_rounds), 2) AS avg_rounds,
        ROUND(AVG(all_review_rounds), 2) AS avg_all_rounds,
        ROUND((100.0 * AVG(CASE WHEN review_rounds = 0 THEN 1 ELSE 0 END))::numeric, 1) AS pct_zero_rounds,
        ROUND((100.0 * AVG(CASE WHEN review_rounds >= 1 THEN 1 ELSE 0 END))::numeric, 1) AS pct_any_round,
        ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY time_to_first_review_hours)
          FILTER (WHERE time_to_first_review_hours IS NOT NULL))::numeric, 2) AS p50_time_to_first_review_hours,
        ROUND((PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY time_to_first_review_hours)
          FILTER (WHERE time_to_first_review_hours IS NOT NULL))::numeric, 2) AS p75_time_to_first_review_hours,
        ROUND((PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY time_to_first_review_hours)
          FILTER (WHERE time_to_first_review_hours IS NOT NULL))::numeric, 2) AS p90_time_to_first_review_hours,
        ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY time_to_effective_approval_hours)
          FILTER (WHERE time_to_effective_approval_hours IS NOT NULL))::numeric, 2) AS p50_time_to_effective_approval_hours,
        ROUND((PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY time_to_effective_approval_hours)
          FILTER (WHERE time_to_effective_approval_hours IS NOT NULL))::numeric, 2) AS p75_time_to_effective_approval_hours,
        ROUND((PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY time_to_effective_approval_hours)
          FILTER (WHERE time_to_effective_approval_hours IS NOT NULL))::numeric, 2) AS p90_time_to_effective_approval_hours
      FROM pr_data
      GROUP BY month, size_bucket
    )
    SELECT
      EXTRACT(YEAR FROM month)::integer AS "year",
      EXTRACT(MONTH FROM month)::integer AS "month",
      size_bucket AS "sizeBucket",
      prs AS "prs",
      ROUND((100.0 * prs / NULLIF(SUM(prs) OVER (PARTITION BY month), 0))::numeric, 1) AS "pctOfMonthPrs",
      avg_rounds AS "avgRounds",
      avg_all_rounds AS "avgAllRounds",
      pct_zero_rounds AS "pctZeroRounds",
      pct_any_round AS "pctAnyRound",
      p50_time_to_first_review_hours AS "p50TimeToFirstReviewHours",
      p75_time_to_first_review_hours AS "p75TimeToFirstReviewHours",
      p90_time_to_first_review_hours AS "p90TimeToFirstReviewHours",
      p50_time_to_effective_approval_hours AS "p50TimeToEffectiveApprovalHours",
      p75_time_to_effective_approval_hours AS "p75TimeToEffectiveApprovalHours",
      p90_time_to_effective_approval_hours AS "p90TimeToEffectiveApprovalHours"
    FROM bucketed
      ORDER BY
      month,
      CASE size_bucket
        WHEN 'Micro (0-10)' THEN 1
        WHEN 'Small (11-75)' THEN 2
        WHEN 'Medium (76-250)' THEN 3
        WHEN 'Large (251-500)' THEN 4
        WHEN 'XL (501-1000)' THEN 5
        ELSE 6
      END
  `;

export const getTrendsPrSizePercentiles = (
  sql: Sql,
  repositoryId: number,
  teamSlug?: string,
) =>
  sql`
    WITH pr_data AS (
      SELECT
        date_trunc('month', pr.merged_at AT TIME ZONE 'America/New_York')::date AS month,
        (COALESCE(pr.additions, 0) + COALESCE(pr.deletions, 0))::numeric AS pr_size
      FROM issue i
      INNER JOIN pull_request pr ON pr.issue_id = i.issue_id
      INNER JOIN "user" u ON u.user_id = i.user_id
      WHERE i.repository_id = ${repositoryId}
        AND i.issue_type_id = 2
        AND pr.merged_at IS NOT NULL
        AND LOWER(pr.target_branch) IN ('main', 'master')
        AND u.gh_login NOT LIKE '%[bot]%'
        ${trendsTeamAuthorFilter(sql, teamSlug)}
    )
    SELECT
      EXTRACT(YEAR FROM month)::integer AS "year",
      EXTRACT(MONTH FROM month)::integer AS "month",
      COUNT(*)::integer AS "mergedPrs",
      ROUND(AVG(pr_size), 2) AS "avgPrSize",
      ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pr_size))::numeric, 2) AS "p50PrSize",
      ROUND((PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY pr_size))::numeric, 2) AS "p75PrSize",
      ROUND((PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY pr_size))::numeric, 2) AS "p90PrSize"
    FROM pr_data
    GROUP BY month
    ORDER BY month
  `;

export const getTrendsAuthorOutputPercentiles = (
  sql: Sql,
  repositoryId: number,
  teamSlug?: string,
) =>
  sql`
    WITH author_monthly_output AS (
      SELECT
        date_trunc('month', pr.merged_at AT TIME ZONE 'America/New_York')::date AS month,
        i.user_id AS author_user_id,
        COUNT(*)::integer AS merged_prs,
        SUM(COALESCE(pr.additions, 0) + COALESCE(pr.deletions, 0))::numeric AS lines_changed
      FROM issue i
      INNER JOIN pull_request pr ON pr.issue_id = i.issue_id
      INNER JOIN "user" u ON u.user_id = i.user_id
      WHERE i.repository_id = ${repositoryId}
        AND i.issue_type_id = 2
        AND pr.merged_at IS NOT NULL
        AND LOWER(pr.target_branch) IN ('main', 'master')
        AND u.gh_login NOT LIKE '%[bot]%'
        ${trendsTeamAuthorFilter(sql, teamSlug)}
      GROUP BY 1, 2
    )
    SELECT
      EXTRACT(YEAR FROM month)::integer AS "year",
      EXTRACT(MONTH FROM month)::integer AS "month",
      COUNT(*)::integer AS "activeAuthors",
      ROUND(AVG(merged_prs), 2) AS "avgMergedPrsPerAuthor",
      ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY merged_prs))::numeric, 2) AS "p50MergedPrsPerAuthor",
      ROUND((PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY merged_prs))::numeric, 2) AS "p75MergedPrsPerAuthor",
      ROUND((PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY merged_prs))::numeric, 2) AS "p90MergedPrsPerAuthor",
      ROUND(AVG(lines_changed), 2) AS "avgLinesChangedPerAuthor",
      ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lines_changed))::numeric, 2) AS "p50LinesChangedPerAuthor",
      ROUND((PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY lines_changed))::numeric, 2) AS "p75LinesChangedPerAuthor",
      ROUND((PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY lines_changed))::numeric, 2) AS "p90LinesChangedPerAuthor"
    FROM author_monthly_output
    GROUP BY month
    ORDER BY month
  `;

export const getTrendsAiAssistedSummary = (
  sql: Sql,
  repositoryId: number,
  teamSlug?: string,
) =>
  sql`
    WITH merged_prs AS (
      SELECT
        pr.pull_request_id,
        date_trunc('month', pr.merged_at AT TIME ZONE 'America/New_York')::date AS month,
        pres.ai_assisted_model
      FROM issue i
      INNER JOIN pull_request pr ON pr.issue_id = i.issue_id
      INNER JOIN "user" u ON u.user_id = i.user_id
      LEFT JOIN pull_request_enhanced_stats pres
        ON pres.pull_request_id = pr.pull_request_id
      WHERE i.repository_id = ${repositoryId}
        AND i.issue_type_id = 2
        AND pr.merged_at IS NOT NULL
        AND LOWER(pr.target_branch) IN ('main', 'master')
        AND u.gh_login NOT LIKE '%[bot]%'
        ${trendsTeamAuthorFilter(sql, teamSlug)}
    ),
    monthly_totals AS (
      SELECT
        month,
        COUNT(*)::integer AS merged_prs
      FROM merged_prs
      GROUP BY month
    ),
    ai_prs_by_month AS (
      SELECT
        month,
        COUNT(*)::integer AS ai_assisted_prs
      FROM merged_prs
      WHERE ai_assisted_model IS NOT NULL
      GROUP BY month
    )
    SELECT
      EXTRACT(YEAR FROM totals.month)::integer AS "year",
      EXTRACT(MONTH FROM totals.month)::integer AS "month",
      totals.merged_prs AS "mergedPrs",
      COALESCE(ai.ai_assisted_prs, 0)::integer AS "aiAssistedPrs",
      ROUND((100.0 * COALESCE(ai.ai_assisted_prs, 0) / NULLIF(totals.merged_prs, 0))::numeric, 1) AS "pctAiAssistedPrs"
    FROM monthly_totals totals
    LEFT JOIN ai_prs_by_month ai ON ai.month = totals.month
    ORDER BY totals.month
  `;

export const getTrendsAiAssistedModelBreakdown = (
  sql: Sql,
  repositoryId: number,
  teamSlug?: string,
) =>
  sql`
    WITH merged_prs AS (
      SELECT
        pr.pull_request_id,
        date_trunc('month', pr.merged_at AT TIME ZONE 'America/New_York')::date AS month,
        pres.ai_assisted_model
      FROM issue i
      INNER JOIN pull_request pr ON pr.issue_id = i.issue_id
      INNER JOIN "user" u ON u.user_id = i.user_id
      LEFT JOIN pull_request_enhanced_stats pres
        ON pres.pull_request_id = pr.pull_request_id
      WHERE i.repository_id = ${repositoryId}
        AND i.issue_type_id = 2
        AND pr.merged_at IS NOT NULL
        AND LOWER(pr.target_branch) IN ('main', 'master')
        AND u.gh_login NOT LIKE '%[bot]%'
        ${trendsTeamAuthorFilter(sql, teamSlug)}
    ),
    monthly_totals AS (
      SELECT
        month,
        COUNT(*)::integer AS merged_prs
      FROM merged_prs
      GROUP BY month
    ),
    normalized_matches AS (
      SELECT DISTINCT
        pull_request_id,
        month,
        ai_assisted_model AS model_key,
        ai_assisted_model AS model_label
      FROM merged_prs
      WHERE ai_assisted_model IS NOT NULL
    ),
    model_counts AS (
      SELECT
        month,
        model_key,
        model_label,
        COUNT(DISTINCT pull_request_id)::integer AS ai_assisted_prs
      FROM normalized_matches
      GROUP BY month, model_key, model_label
    )
    SELECT
      EXTRACT(YEAR FROM model_counts.month)::integer AS "year",
      EXTRACT(MONTH FROM model_counts.month)::integer AS "month",
      model_counts.model_label AS "model",
      totals.merged_prs AS "mergedPrs",
      model_counts.ai_assisted_prs AS "aiAssistedPrs",
      ROUND((100.0 * model_counts.ai_assisted_prs / NULLIF(totals.merged_prs, 0))::numeric, 1) AS "pctAiAssistedPrs"
    FROM model_counts
    INNER JOIN monthly_totals totals ON totals.month = model_counts.month
    ORDER BY
      model_counts.month,
      CASE WHEN model_counts.model_key = 'claude-unspecified' THEN 1 ELSE 0 END,
      model_counts.model_label
  `;
