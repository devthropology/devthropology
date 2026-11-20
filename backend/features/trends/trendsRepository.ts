import {
  TrendsAiAssistedInsightsResponse,
  TrendsAiAssistedInsightsResponseSchema,
  TrendsPrSizeInsightsResponse,
  TrendsPrSizeInsightsResponseSchema,
  TrendsPrSizePercentilesResponse,
  TrendsPrSizePercentilesResponseSchema,
  TrendsReviewRoundsInsightsResponse,
  TrendsReviewRoundsInsightsResponseSchema,
} from "../../../shared/models/trendsInsights.ts";
import {
  ComputedTrendsMonthly,
  ComputedTrendsMonthlyAiModel,
  ComputedTrendsMonthlyAiModelSchema,
  ComputedTrendsMonthlySchema,
  ComputedTrendsMonthlySizeBucket,
  ComputedTrendsMonthlySizeBucketSchema,
} from "../../models/dbTypes.ts";
import { SqlClient } from "../../repository/sqlClient.ts";
import {
  getTrendsAiAssistedModelBreakdown,
  getTrendsAiAssistedSummary,
  getTrendsAuthorOutputPercentiles,
  getTrendsPrSizeInsights,
  getTrendsPrSizePercentiles,
  getTrendsReviewRoundsInsights,
} from "./trendsQueries.ts";

export const AI_SUMMARY_MODEL = "__summary__";

export class TrendsRepository {
  constructor(private readonly sql: SqlClient) {}

  async recomputeMonthlyForRepository(repositoryId: number): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`
        DELETE FROM computed_trends_monthly
        WHERE repository_id = ${repositoryId}
      `;

      await tx`
        DELETE FROM computed_trends_monthly_size_bucket
        WHERE repository_id = ${repositoryId}
      `;

      await tx`
        DELETE FROM computed_trends_monthly_ai_model
        WHERE repository_id = ${repositoryId}
      `;

      await tx`
        WITH merged_prs AS (
          SELECT
            i.repository_id,
            date_trunc('month', pr.merged_at AT TIME ZONE 'America/New_York')::date AS month,
            i.user_id AS author_user_id,
            (COALESCE(pr.additions, 0) + COALESCE(pr.deletions, 0))::numeric AS pr_size,
            COALESCE(pres.rounds_of_review, prror.rounds, 0)::numeric AS review_rounds,
            (
              COALESCE(pres.rounds_of_review, prror.rounds, 0) +
              COALESCE(pres.bot_rounds_of_review, 0)
            )::numeric AS all_review_rounds,
            EXTRACT(EPOCH FROM (pres.first_review_at - i.created_at)) / 3600.0
              AS time_to_first_review_hours,
            EXTRACT(EPOCH FROM (pres.first_effective_approval_at - i.created_at)) / 3600.0
              AS time_to_effective_approval_hours
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
        ),
        monthly_pr_size AS (
          SELECT
            EXTRACT(YEAR FROM month)::integer AS year,
            EXTRACT(MONTH FROM month)::integer AS month,
            COUNT(*)::integer AS merged_prs,
            ROUND(AVG(pr_size), 2) AS avg_pr_size,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pr_size))::numeric, 2) AS p50_pr_size,
            ROUND((PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY pr_size))::numeric, 2) AS p75_pr_size,
            ROUND((PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY pr_size))::numeric, 2) AS p90_pr_size
          FROM merged_prs
          GROUP BY 1, 2
        ),
        author_monthly_output AS (
          SELECT
            month,
            author_user_id,
            COUNT(*)::integer AS merged_prs,
            SUM(pr_size)::numeric AS lines_changed
          FROM merged_prs
          GROUP BY 1, 2
        ),
        monthly_author_output AS (
          SELECT
            EXTRACT(YEAR FROM month)::integer AS year,
            EXTRACT(MONTH FROM month)::integer AS month,
            COUNT(*)::integer AS active_authors,
            ROUND(AVG(merged_prs), 2) AS avg_merged_prs_per_author,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY merged_prs))::numeric, 2) AS p50_merged_prs_per_author,
            ROUND((PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY merged_prs))::numeric, 2) AS p75_merged_prs_per_author,
            ROUND((PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY merged_prs))::numeric, 2) AS p90_merged_prs_per_author,
            ROUND(AVG(lines_changed), 2) AS avg_lines_changed_per_author,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lines_changed))::numeric, 2) AS p50_lines_changed_per_author,
            ROUND((PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY lines_changed))::numeric, 2) AS p75_lines_changed_per_author,
            ROUND((PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY lines_changed))::numeric, 2) AS p90_lines_changed_per_author
          FROM author_monthly_output
          GROUP BY 1, 2
        ),
        monthly_review_rounds AS (
          SELECT
            EXTRACT(YEAR FROM month)::integer AS year,
            EXTRACT(MONTH FROM month)::integer AS month,
            ROUND(AVG(review_rounds), 2) AS avg_rounds,
            ROUND(AVG(all_review_rounds), 2) AS avg_all_rounds,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY review_rounds))::numeric, 2) AS p50_rounds,
            ROUND((PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY review_rounds))::numeric, 2) AS p75_rounds,
            ROUND((PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY review_rounds))::numeric, 2) AS p90_rounds,
            ROUND((PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY review_rounds))::numeric, 2) AS p95_rounds,
            ROUND((PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY review_rounds))::numeric, 2) AS p99_rounds,
            ROUND((100.0 * AVG(CASE WHEN review_rounds = 0 THEN 1 ELSE 0 END))::numeric, 1) AS pct_zero_rounds,
            ROUND((100.0 * AVG(CASE WHEN review_rounds = 1 THEN 1 ELSE 0 END))::numeric, 1) AS pct_one_round,
            ROUND((100.0 * AVG(CASE WHEN review_rounds = 2 THEN 1 ELSE 0 END))::numeric, 1) AS pct_two_rounds,
            ROUND((100.0 * AVG(CASE WHEN review_rounds >= 3 THEN 1 ELSE 0 END))::numeric, 1) AS pct_three_plus_rounds,
            ROUND((100.0 * AVG(CASE WHEN review_rounds >= 1 THEN 1 ELSE 0 END))::numeric, 1) AS pct_any_round,
            ROUND((100.0 * AVG(CASE WHEN review_rounds >= 2 THEN 1 ELSE 0 END))::numeric, 1) AS pct_two_plus_rounds,
            ROUND((100.0 * AVG(CASE WHEN all_review_rounds >= 1 THEN 1 ELSE 0 END))::numeric, 1) AS pct_any_all_rounds,
            ROUND((100.0 * AVG(CASE WHEN all_review_rounds >= 2 THEN 1 ELSE 0 END))::numeric, 1) AS pct_two_plus_all_rounds,
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
          FROM merged_prs
          GROUP BY 1, 2
        ),
        all_months AS (
          SELECT year, month FROM monthly_pr_size
          UNION
          SELECT year, month FROM monthly_author_output
          UNION
          SELECT year, month FROM monthly_review_rounds
        )
        INSERT INTO computed_trends_monthly (
          repository_id,
          year,
          month,
          merged_prs,
          avg_pr_size,
          p50_pr_size,
          p75_pr_size,
          p90_pr_size,
          active_authors,
          avg_merged_prs_per_author,
          p50_merged_prs_per_author,
          p75_merged_prs_per_author,
          p90_merged_prs_per_author,
          avg_lines_changed_per_author,
          p50_lines_changed_per_author,
          p75_lines_changed_per_author,
          p90_lines_changed_per_author,
          avg_rounds,
          avg_all_rounds,
          p50_rounds,
          p75_rounds,
          p90_rounds,
          p95_rounds,
          p99_rounds,
          pct_zero_rounds,
          pct_one_round,
          pct_two_rounds,
          pct_three_plus_rounds,
          pct_any_round,
          pct_two_plus_rounds,
          pct_any_all_rounds,
          pct_two_plus_all_rounds,
          p50_time_to_first_review_hours,
          p75_time_to_first_review_hours,
          p90_time_to_first_review_hours,
          p50_time_to_effective_approval_hours,
          p75_time_to_effective_approval_hours,
          p90_time_to_effective_approval_hours,
          computed_at
        )
        SELECT
          ${repositoryId},
          months.year,
          months.month,
          pr_size.merged_prs,
          pr_size.avg_pr_size,
          pr_size.p50_pr_size,
          pr_size.p75_pr_size,
          pr_size.p90_pr_size,
          author.active_authors,
          author.avg_merged_prs_per_author,
          author.p50_merged_prs_per_author,
          author.p75_merged_prs_per_author,
          author.p90_merged_prs_per_author,
          author.avg_lines_changed_per_author,
          author.p50_lines_changed_per_author,
          author.p75_lines_changed_per_author,
          author.p90_lines_changed_per_author,
          review.avg_rounds,
          review.avg_all_rounds,
          review.p50_rounds,
          review.p75_rounds,
          review.p90_rounds,
          review.p95_rounds,
          review.p99_rounds,
          review.pct_zero_rounds,
          review.pct_one_round,
          review.pct_two_rounds,
          review.pct_three_plus_rounds,
          review.pct_any_round,
          review.pct_two_plus_rounds,
          review.pct_any_all_rounds,
          review.pct_two_plus_all_rounds,
          review.p50_time_to_first_review_hours,
          review.p75_time_to_first_review_hours,
          review.p90_time_to_first_review_hours,
          review.p50_time_to_effective_approval_hours,
          review.p75_time_to_effective_approval_hours,
          review.p90_time_to_effective_approval_hours,
          CURRENT_TIMESTAMP
        FROM all_months months
        LEFT JOIN monthly_pr_size pr_size
          ON pr_size.year = months.year
         AND pr_size.month = months.month
        LEFT JOIN monthly_author_output author
          ON author.year = months.year
         AND author.month = months.month
        LEFT JOIN monthly_review_rounds review
          ON review.year = months.year
         AND review.month = months.month
        ORDER BY months.year, months.month
      `;

      await tx`
        WITH merged_prs AS (
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
            EXTRACT(EPOCH FROM (pres.first_effective_approval_at - i.created_at)) / 3600.0
              AS time_to_effective_approval_hours
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
        ),
        bucketed AS (
          SELECT
            EXTRACT(YEAR FROM month)::integer AS year,
            EXTRACT(MONTH FROM month)::integer AS month,
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
          FROM merged_prs
          GROUP BY 1, 2, 3
        )
        INSERT INTO computed_trends_monthly_size_bucket (
          repository_id,
          year,
          month,
          size_bucket,
          prs,
          pct_of_month_prs,
          avg_rounds,
          avg_all_rounds,
          pct_zero_rounds,
          pct_any_round,
          p50_time_to_first_review_hours,
          p75_time_to_first_review_hours,
          p90_time_to_first_review_hours,
          p50_time_to_effective_approval_hours,
          p75_time_to_effective_approval_hours,
          p90_time_to_effective_approval_hours,
          computed_at
        )
        SELECT
          ${repositoryId},
          year,
          month,
          size_bucket,
          prs,
          ROUND((100.0 * prs / NULLIF(SUM(prs) OVER (PARTITION BY year, month), 0))::numeric, 1),
          avg_rounds,
          avg_all_rounds,
          pct_zero_rounds,
          pct_any_round,
          p50_time_to_first_review_hours,
          p75_time_to_first_review_hours,
          p90_time_to_first_review_hours,
          p50_time_to_effective_approval_hours,
          p75_time_to_effective_approval_hours,
          p90_time_to_effective_approval_hours,
          CURRENT_TIMESTAMP
        FROM bucketed
        ORDER BY
          year,
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

      await tx`
        WITH merged_prs AS (
          SELECT
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
        ),
        monthly_totals AS (
          SELECT
            EXTRACT(YEAR FROM month)::integer AS year,
            EXTRACT(MONTH FROM month)::integer AS month,
            COUNT(*)::integer AS merged_prs,
            COUNT(*) FILTER (WHERE ai_assisted_model IS NOT NULL)::integer AS ai_assisted_prs
          FROM merged_prs
          GROUP BY 1, 2
        ),
        raw_model_counts AS (
          SELECT
            EXTRACT(YEAR FROM month)::integer AS year,
            EXTRACT(MONTH FROM month)::integer AS month,
            ai_assisted_model AS model,
            COUNT(*)::integer AS ai_assisted_prs
          FROM merged_prs
          WHERE ai_assisted_model IS NOT NULL
          GROUP BY 1, 2, 3
        )
        INSERT INTO computed_trends_monthly_ai_model (
          repository_id,
          year,
          month,
          model,
          merged_prs,
          ai_assisted_prs,
          pct_ai_assisted_prs,
          computed_at
        )
        SELECT
          ${repositoryId}::bigint,
          year,
          month,
          ${AI_SUMMARY_MODEL},
          merged_prs,
          ai_assisted_prs,
          ROUND((100.0 * ai_assisted_prs / NULLIF(merged_prs, 0))::numeric, 1),
          CURRENT_TIMESTAMP
        FROM monthly_totals
        UNION ALL
        SELECT
          ${repositoryId}::bigint,
          model_counts.year,
          model_counts.month,
          model_counts.model,
          totals.merged_prs,
          model_counts.ai_assisted_prs,
          ROUND((100.0 * model_counts.ai_assisted_prs / NULLIF(totals.merged_prs, 0))::numeric, 1),
          CURRENT_TIMESTAMP
        FROM raw_model_counts model_counts
        INNER JOIN monthly_totals totals
          ON totals.year = model_counts.year
         AND totals.month = model_counts.month
        ORDER BY 2, 3, 4
      `;
    });
  }

  async getComputedMonthly(
    repositoryId: number,
  ): Promise<ComputedTrendsMonthly[]> {
    const rows = await this.sql<ComputedTrendsMonthly[]>`
      SELECT
        repository_id,
        year,
        month,
        merged_prs,
        avg_pr_size,
        p50_pr_size,
        p75_pr_size,
        p90_pr_size,
        active_authors,
        avg_merged_prs_per_author,
        p50_merged_prs_per_author,
        p75_merged_prs_per_author,
        p90_merged_prs_per_author,
        avg_lines_changed_per_author,
        p50_lines_changed_per_author,
        p75_lines_changed_per_author,
        p90_lines_changed_per_author,
        avg_rounds,
        avg_all_rounds,
        p50_rounds,
        p75_rounds,
        p90_rounds,
        p95_rounds,
        p99_rounds,
        pct_zero_rounds,
        pct_one_round,
        pct_two_rounds,
        pct_three_plus_rounds,
        pct_any_round,
        pct_two_plus_rounds,
        pct_any_all_rounds,
        pct_two_plus_all_rounds,
        p50_time_to_first_review_hours,
        p75_time_to_first_review_hours,
        p90_time_to_first_review_hours,
        p50_time_to_effective_approval_hours,
        p75_time_to_effective_approval_hours,
        p90_time_to_effective_approval_hours,
        computed_at
      FROM computed_trends_monthly
      WHERE repository_id = ${repositoryId}
      ORDER BY year, month
    `;

    return rows.map((row) => ComputedTrendsMonthlySchema.parse(row));
  }

  async getComputedMonthlySizeBuckets(
    repositoryId: number,
  ): Promise<ComputedTrendsMonthlySizeBucket[]> {
    const rows = await this.sql<ComputedTrendsMonthlySizeBucket[]>`
      SELECT
        repository_id,
        year,
        month,
        size_bucket,
        prs,
        pct_of_month_prs,
        avg_rounds,
        avg_all_rounds,
        pct_zero_rounds,
        pct_any_round,
        p50_time_to_first_review_hours,
        p75_time_to_first_review_hours,
        p90_time_to_first_review_hours,
        p50_time_to_effective_approval_hours,
        p75_time_to_effective_approval_hours,
        p90_time_to_effective_approval_hours,
        computed_at
      FROM computed_trends_monthly_size_bucket
      WHERE repository_id = ${repositoryId}
      ORDER BY
        year,
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

    return rows.map((row) => ComputedTrendsMonthlySizeBucketSchema.parse(row));
  }

  async getComputedMonthlyAiModels(
    repositoryId: number,
  ): Promise<ComputedTrendsMonthlyAiModel[]> {
    const rows = await this.sql<ComputedTrendsMonthlyAiModel[]>`
      SELECT
        repository_id,
        year,
        month,
        model,
        merged_prs,
        ai_assisted_prs,
        pct_ai_assisted_prs,
        computed_at
      FROM computed_trends_monthly_ai_model
      WHERE repository_id = ${repositoryId}
      ORDER BY year, month, model
    `;

    return rows.map((row) => ComputedTrendsMonthlyAiModelSchema.parse(row));
  }

  async getReviewRoundsInsights(
    repositoryId: number,
    teamSlug?: string,
  ): Promise<TrendsReviewRoundsInsightsResponse> {
    const rawData = await getTrendsReviewRoundsInsights(
      this.sql,
      repositoryId,
      teamSlug,
    );
    return TrendsReviewRoundsInsightsResponseSchema.parse({
      points: rawData,
    });
  }

  async getPrSizeInsights(
    repositoryId: number,
    teamSlug?: string,
  ): Promise<TrendsPrSizeInsightsResponse> {
    const rawData = await getTrendsPrSizeInsights(
      this.sql,
      repositoryId,
      teamSlug,
    );
    return TrendsPrSizeInsightsResponseSchema.parse({
      points: rawData,
    });
  }

  async getPrSizePercentiles(
    repositoryId: number,
    teamSlug?: string,
  ): Promise<TrendsPrSizePercentilesResponse> {
    const [rawPrSizeData, rawAuthorOutputData] = await Promise.all([
      getTrendsPrSizePercentiles(this.sql, repositoryId, teamSlug),
      getTrendsAuthorOutputPercentiles(this.sql, repositoryId, teamSlug),
    ]);

    return TrendsPrSizePercentilesResponseSchema.parse({
      points: rawPrSizeData,
      authorOutput: { points: rawAuthorOutputData },
    });
  }

  async getAiAssistedInsights(
    repositoryId: number,
    teamSlug?: string,
  ): Promise<TrendsAiAssistedInsightsResponse> {
    const [rawSummaryPoints, rawModelPoints] = await Promise.all([
      getTrendsAiAssistedSummary(this.sql, repositoryId, teamSlug),
      getTrendsAiAssistedModelBreakdown(this.sql, repositoryId, teamSlug),
    ]);

    const hydratedPointMap = new Map<
      string,
      {
        year: number;
        month: number;
        model: string;
        mergedPrs: number;
        aiAssistedPrs: number;
        pctAiAssistedPrs: number;
      }
    >();

    for (const point of rawModelPoints) {
      const model = normalizeAiAssistedModel(point.model);
      const mapKey = `${point.year}-${point.month}-${model}`;
      const existing = hydratedPointMap.get(mapKey);

      if (existing) {
        existing.aiAssistedPrs += point.aiAssistedPrs;
        existing.pctAiAssistedPrs = Number(
          ((existing.aiAssistedPrs / existing.mergedPrs) * 100).toFixed(1),
        );
        continue;
      }

      hydratedPointMap.set(mapKey, {
        year: point.year,
        month: point.month,
        model,
        mergedPrs: point.mergedPrs,
        aiAssistedPrs: point.aiAssistedPrs,
        pctAiAssistedPrs: point.pctAiAssistedPrs,
      });
    }

    const hydratedModelPoints = Array.from(hydratedPointMap.values()).sort(
      (left, right) => {
        if (left.year !== right.year) return left.year - right.year;
        if (left.month !== right.month) return left.month - right.month;
        return left.model.localeCompare(right.model);
      },
    );

    return TrendsAiAssistedInsightsResponseSchema.parse({
      points: rawSummaryPoints,
      modelPoints: hydratedModelPoints,
    });
  }
}

export function normalizeAiAssistedModel(model: string): string {
  const trimmed = model.trim();
  const lower = trimmed.toLowerCase();

  const providerMatch = lower.match(
    /(?:^claude\s+|^claude\s*\()(?:(?:us|global)\.anthropic\.)?claude-(opus|sonnet)-(\d+)-(\d+)/,
  );

  if (providerMatch) {
    const [, family, major, minor] = providerMatch;
    return `Claude ${family.charAt(0).toUpperCase()}${family.slice(
      1,
    )} ${major}.${minor}`;
  }

  return trimmed;
}
