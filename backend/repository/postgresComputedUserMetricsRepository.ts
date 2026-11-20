import {
  ComputedUserMetricRecord,
  ComputedUserMetricRecordSchema,
  ComputedUserMetricsRepository,
} from "./computedUserMetricsRepository.ts";
import {
  ComputedUserMetrics,
  ComputedUserMetricsSchema,
  USER_METRIC_KEYS,
  USER_METRIC_PERIODS,
} from "../../shared/models/userMetrics.ts";
import { SqlClient } from "./sqlClient.ts";

type Sql = SqlClient;

const METRIC_PERIOD_CONFIG = [
  { period: USER_METRIC_PERIODS.ALL_TIME, intervalText: null },
  { period: USER_METRIC_PERIODS.ONE_MONTH, intervalText: "1 month" },
  { period: USER_METRIC_PERIODS.THREE_MONTHS, intervalText: "3 months" },
  { period: USER_METRIC_PERIODS.ONE_YEAR, intervalText: "1 year" },
] as const;

type MetricPeriodOption = (typeof METRIC_PERIOD_CONFIG)[number];

type RawComputedUserMetricsRow = {
  computed_user_metrics_id: number;
  user_id: number;
  repository_id: number;
  metric_key: string;
  period: string;
  value: string; // postgres returns bigint as string
  rank: number | string | null;
  rank_out_of: number | string | null;
  inserted_at: Date | string;
};

export class PostgresComputedUserMetricsRepository implements ComputedUserMetricsRepository {
  private readonly sql: SqlClient;

  constructor(sql: SqlClient) {
    this.sql = sql;
  }

  async close(): Promise<void> {
    // No-op: caller owns SqlClient lifecycle
  }

  async recomputeAllMetricsForRepository(repositoryId: number): Promise<void> {
    try {
      await this.sql.begin(async (tx) => {
        await this.deleteMetricsForRepository(tx, repositoryId);
        await this.computeMergedPrsMetrics(tx, repositoryId);
        await this.computeLinesModifiedMetrics(tx, repositoryId);
        await this.computePrsReviewedMetrics(tx, repositoryId);
        await this.computePrCommentsAddedMetrics(tx, repositoryId);
      });
    } catch (error) {
      console.error("Error during user metrics recomputation:", error);
      throw error;
    }
  }

  async recomputePullRequestMetricsForRepository(
    repositoryId: number,
  ): Promise<void> {
    await this.sql.begin(async (tx: Sql) => {
      await tx`
        DELETE FROM computed_pull_request_metrics cprm
        USING pull_request pr
        JOIN issue i ON pr.issue_id = i.issue_id
        WHERE cprm.pull_request_id = pr.pull_request_id
          AND i.repository_id = ${repositoryId}
          AND i.issue_type_id = 2
      `;

      await tx`
        INSERT INTO computed_pull_request_metrics (
          pull_request_id,
          contributor_age_days,
          repository_id,
          merged_at,
          issue_created_at,
          target_branch,
          additions,
          deletions,
          changed_files,
          files_added,
          files_modified,
          files_removed,
          files_renamed
        )
        SELECT
          pr.pull_request_id,
          GREATEST(
            0,
            FLOOR(EXTRACT(EPOCH FROM (pr.merged_at - ua.first_seen_timestamp)) / 86400)
          )::INTEGER AS contributor_age_days,
          i.repository_id,
          pr.merged_at,
          i.created_at,
          pr.target_branch,
          COALESCE(pr.additions, 0) AS additions,
          COALESCE(pr.deletions, 0) AS deletions,
          COALESCE(pr.changed_files, 0) AS changed_files,
          COALESCE(fc.files_added, 0) AS files_added,
          COALESCE(fc.files_modified, 0) AS files_modified,
          COALESCE(fc.files_removed, 0) AS files_removed,
          COALESCE(fc.files_renamed, 0) AS files_renamed
        FROM pull_request pr
        JOIN issue i ON pr.issue_id = i.issue_id
        JOIN user_activity ua
          ON ua.user_id = i.user_id
          AND ua.repository_id = i.repository_id
        LEFT JOIN (
          SELECT
            prf.pull_request_id,
            COUNT(*) FILTER (WHERE prf.status = 'added') AS files_added,
            COUNT(*) FILTER (WHERE prf.status = 'modified') AS files_modified,
            COUNT(*) FILTER (WHERE prf.status = 'removed') AS files_removed,
            COUNT(*) FILTER (WHERE prf.status = 'renamed') AS files_renamed
          FROM pull_request_file prf
          JOIN pull_request pr2 ON pr2.pull_request_id = prf.pull_request_id
          JOIN issue i2 ON i2.issue_id = pr2.issue_id
          WHERE i2.repository_id = ${repositoryId}
          GROUP BY prf.pull_request_id
        ) fc ON fc.pull_request_id = pr.pull_request_id
        WHERE i.repository_id = ${repositoryId}
          AND i.issue_type_id = 2
          AND pr.merged_at IS NOT NULL
          AND ua.first_seen_timestamp IS NOT NULL
      `;
    });
  }

  async getMetricsForUser(
    repositoryId: number,
    ghLogin: string,
  ): Promise<ComputedUserMetrics> {
    const rows = await this.sql<RawComputedUserMetricsRow[]>`
      SELECT 
        cum.computed_user_metrics_id,
        cum.user_id,
        cum.repository_id,
        cum.metric_key,
        cum.period,
        cum.value,
        cum.rank,
        cum.rank_out_of,
        cum.inserted_at
      FROM computed_user_metrics cum
      INNER JOIN "user" u ON u.user_id = cum.user_id
      WHERE cum.repository_id = ${repositoryId}
        AND u.gh_login = ${ghLogin}
      ORDER BY cum.metric_key, cum.period
    `;

    if (rows.length === 0) {
      return ComputedUserMetricsSchema.parse({ metrics: {} });
    }

    const metricsMap: Record<
      string,
      Record<
        string,
        {
          value: number;
          rank: number | null;
          rankOutOf: number | null;
        }
      >
    > = {};

    for (const row of rows) {
      const parsed = this.mapRow(row);
      const { metricKey, period, value, rank, rankOutOf } = parsed;

      if (!metricsMap[metricKey]) {
        metricsMap[metricKey] = {};
      }
      metricsMap[metricKey][period] = {
        value,
        rank,
        rankOutOf,
      };
    }

    for (const key of Object.values(USER_METRIC_KEYS)) {
      const existingPeriods = metricsMap[key] ?? {};
      const normalizedPeriods: Record<
        string,
        {
          value: number;
          rank: number | null;
          rankOutOf: number | null;
        }
      > = {};

      for (const period of Object.values(USER_METRIC_PERIODS)) {
        const current = existingPeriods[period];
        normalizedPeriods[period] = current ?? {
          value: 0,
          rank: null,
          rankOutOf: null,
        };
      }

      metricsMap[key] = normalizedPeriods;
    }

    return ComputedUserMetricsSchema.parse({ metrics: metricsMap });
  }

  private async deleteMetricsForRepository(
    tx: Sql,
    repositoryId: number,
  ): Promise<void> {
    await tx`
      DELETE FROM computed_user_metrics 
      WHERE repository_id = ${repositoryId}
    `;
  }

  private async computeMergedPrsMetrics(
    tx: Sql,
    repositoryId: number,
  ): Promise<void> {
    for (const periodOption of METRIC_PERIOD_CONFIG) {
      await this.insertMergedPrsMetrics(tx, repositoryId, periodOption);
    }
  }

  private async insertMergedPrsMetrics(
    tx: Sql,
    repositoryId: number,
    options: MetricPeriodOption,
  ): Promise<void> {
    const { period, intervalText } = options;
    const intervalClause =
      intervalText === null
        ? tx``
        : tx`AND pr.merged_at >= NOW() - ( ${intervalText}::interval )`;

    await tx`
      WITH merged AS (
        SELECT
          u.user_id,
          u.gh_login,
          i.repository_id,
          COUNT(*)::bigint AS value
        FROM issue i
        INNER JOIN "user" u ON u.user_id = i.user_id
        INNER JOIN pull_request pr ON pr.issue_id = i.issue_id
        WHERE i.repository_id = ${repositoryId}
          AND i.issue_type_id = 2
          AND pr.merged_at IS NOT NULL
          AND LOWER(pr.target_branch) IN ('main', 'master')
          ${intervalClause}
        GROUP BY u.user_id, u.gh_login, i.repository_id
      ),
      human_ranked AS (
        SELECT
          user_id,
          repository_id,
          value,
          DENSE_RANK() OVER (ORDER BY value DESC) AS rank,
          COUNT(*) OVER () AS rank_out_of
        FROM merged
        WHERE gh_login NOT LIKE '%[bot]%'
      )
      INSERT INTO computed_user_metrics (
        user_id,
        repository_id,
        metric_key,
        period,
        value,
        rank,
        rank_out_of
      )
      SELECT
        user_id,
        repository_id,
        ${USER_METRIC_KEYS.PRS_MERGED},
        ${period},
        value,
        rank,
        rank_out_of
      FROM human_ranked

      UNION ALL

      SELECT
        user_id,
        repository_id,
        ${USER_METRIC_KEYS.PRS_MERGED},
        ${period},
        value,
        NULL::integer AS rank,
        NULL::integer AS rank_out_of
      FROM merged
      WHERE gh_login LIKE '%[bot]%'
    `;
  }

  private async computeLinesModifiedMetrics(
    tx: Sql,
    repositoryId: number,
  ): Promise<void> {
    for (const periodOption of METRIC_PERIOD_CONFIG) {
      await this.insertLinesModifiedMetrics(tx, repositoryId, periodOption);
    }
  }

  private async insertLinesModifiedMetrics(
    tx: Sql,
    repositoryId: number,
    options: MetricPeriodOption,
  ): Promise<void> {
    const { period, intervalText } = options;
    const intervalClause =
      intervalText === null
        ? tx``
        : tx`AND pr.merged_at >= NOW() - ( ${intervalText}::interval )`;

    await tx`
      WITH contribution_totals AS (
        SELECT
          u.user_id,
          u.gh_login,
          i.repository_id,
          SUM(pr.additions + pr.deletions)::bigint AS value
        FROM issue i
        INNER JOIN "user" u ON u.user_id = i.user_id
        INNER JOIN pull_request pr ON pr.issue_id = i.issue_id
        WHERE i.repository_id = ${repositoryId}
          AND i.issue_type_id = 2
          AND pr.merged_at IS NOT NULL
          AND LOWER(pr.target_branch) IN ('main', 'master')
          ${intervalClause}
        GROUP BY u.user_id, u.gh_login, i.repository_id
      ),
      human_ranked AS (
        SELECT
          user_id,
          repository_id,
          value,
          DENSE_RANK() OVER (ORDER BY value DESC) AS rank,
          COUNT(*) OVER () AS rank_out_of
        FROM contribution_totals
        WHERE gh_login NOT LIKE '%[bot]%'
      )
      INSERT INTO computed_user_metrics (
        user_id,
        repository_id,
        metric_key,
        period,
        value,
        rank,
        rank_out_of
      )
      SELECT
        user_id,
        repository_id,
        ${USER_METRIC_KEYS.LINES_MODIFIED},
        ${period},
        value,
        rank,
        rank_out_of
      FROM human_ranked

      UNION ALL

      SELECT
        user_id,
        repository_id,
        ${USER_METRIC_KEYS.LINES_MODIFIED},
        ${period},
        value,
        NULL::integer AS rank,
        NULL::integer AS rank_out_of
      FROM contribution_totals
      WHERE gh_login LIKE '%[bot]%'
    `;
  }

  private async computePrsReviewedMetrics(
    tx: Sql,
    repositoryId: number,
  ): Promise<void> {
    for (const periodOption of METRIC_PERIOD_CONFIG) {
      await this.insertPrsReviewedMetrics(tx, repositoryId, periodOption);
    }
  }

  private async insertPrsReviewedMetrics(
    tx: Sql,
    repositoryId: number,
    options: MetricPeriodOption,
  ): Promise<void> {
    const { period, intervalText } = options;
    const intervalClause =
      intervalText === null
        ? tx``
        : tx`AND interaction_time >= NOW() - ( ${intervalText}::interval )`;

    await tx`
      WITH review_interactions AS (
        SELECT
          pr.pull_request_id,
          prr.user_id AS reviewer_id,
          prr.submitted_at AS interaction_time
        FROM pull_request_review prr
        INNER JOIN pull_request pr ON pr.pull_request_id = prr.pull_request_id
        INNER JOIN issue i ON i.issue_id = pr.issue_id
        WHERE i.repository_id = ${repositoryId}
          AND i.issue_type_id = 2
          AND prr.user_id <> i.user_id
          AND (prr.body <> '' OR prr.state = 'APPROVED')

        UNION ALL

        SELECT
          pr.pull_request_id,
          prc.user_id AS reviewer_id,
          prc.created_at AS interaction_time
        FROM pull_request_comment prc
        INNER JOIN pull_request pr ON pr.pull_request_id = prc.pull_request_id
        INNER JOIN issue i ON i.issue_id = pr.issue_id
        WHERE i.repository_id = ${repositoryId}
          AND i.issue_type_id = 2
          AND prc.user_id <> i.user_id

        UNION ALL

        SELECT
          pr.pull_request_id,
          ic.user_id AS reviewer_id,
          ic.created_at AS interaction_time
        FROM issue_comment ic
        INNER JOIN issue i ON i.issue_id = ic.issue_id
        INNER JOIN pull_request pr ON pr.issue_id = i.issue_id
        WHERE i.repository_id = ${repositoryId}
          AND i.issue_type_id = 2
          AND ic.user_id <> i.user_id
      ),
      reviewer_summary AS (
        SELECT
          ri.reviewer_id,
          u.gh_login,
          COUNT(DISTINCT ri.pull_request_id)::bigint AS value
        FROM review_interactions ri
        INNER JOIN "user" u ON u.user_id = ri.reviewer_id
        WHERE ri.interaction_time IS NOT NULL
          ${intervalClause}
        GROUP BY ri.reviewer_id, u.gh_login
      ),
      human_ranked AS (
        SELECT
          reviewer_id,
          value,
          DENSE_RANK() OVER (ORDER BY value DESC) AS rank,
          COUNT(*) OVER () AS rank_out_of
        FROM reviewer_summary
        WHERE gh_login NOT LIKE '%[bot]%'
      )
      INSERT INTO computed_user_metrics (
        user_id,
        repository_id,
        metric_key,
        period,
        value,
        rank,
        rank_out_of
      )
      SELECT
        hr.reviewer_id,
        ${repositoryId}::bigint,
        ${USER_METRIC_KEYS.PRS_REVIEWED},
        ${period},
        hr.value,
        hr.rank,
        hr.rank_out_of
      FROM human_ranked hr

      UNION ALL

      SELECT
        rs.reviewer_id,
        ${repositoryId}::bigint,
        ${USER_METRIC_KEYS.PRS_REVIEWED},
        ${period},
        rs.value,
        NULL::integer AS rank,
        NULL::integer AS rank_out_of
      FROM reviewer_summary rs
      WHERE rs.gh_login LIKE '%[bot]%'
    `;
  }

  private async computePrCommentsAddedMetrics(
    tx: Sql,
    repositoryId: number,
  ): Promise<void> {
    for (const periodOption of METRIC_PERIOD_CONFIG) {
      await this.insertPrCommentsAddedMetrics(tx, repositoryId, periodOption);
    }
  }

  private async insertPrCommentsAddedMetrics(
    tx: Sql,
    repositoryId: number,
    options: MetricPeriodOption,
  ): Promise<void> {
    const { period, intervalText } = options;
    const intervalClause =
      intervalText === null
        ? tx``
        : tx`AND interaction_time >= NOW() - ( ${intervalText}::interval )`;

    // Potential enhancement: consider minimum-length thresholds or sentiment
    // scoring to discount low-signal comments like "LGTM".
    await tx`
      WITH comment_events AS (
        SELECT
          pr.pull_request_id,
          prc.user_id AS commenter_id,
          prc.created_at AS interaction_time
        FROM pull_request_comment prc
        INNER JOIN pull_request pr ON pr.pull_request_id = prc.pull_request_id
        INNER JOIN issue i ON i.issue_id = pr.issue_id
        WHERE i.repository_id = ${repositoryId}
          AND i.issue_type_id = 2
          AND prc.user_id <> i.user_id

        UNION ALL

        SELECT
          pr.pull_request_id,
          ic.user_id AS commenter_id,
          ic.created_at AS interaction_time
        FROM issue_comment ic
        INNER JOIN issue i ON i.issue_id = ic.issue_id
        INNER JOIN pull_request pr ON pr.issue_id = i.issue_id
        WHERE i.repository_id = ${repositoryId}
          AND i.issue_type_id = 2
          AND ic.user_id <> i.user_id

        UNION ALL

        SELECT
          pr.pull_request_id,
          prr.user_id AS commenter_id,
          prr.submitted_at AS interaction_time
        FROM pull_request_review prr
        INNER JOIN pull_request pr ON pr.pull_request_id = prr.pull_request_id
        INNER JOIN issue i ON i.issue_id = pr.issue_id
        WHERE i.repository_id = ${repositoryId}
          AND i.issue_type_id = 2
          AND prr.user_id <> i.user_id
          AND prr.body <> ''
      ),
      commenter_summary AS (
        SELECT
          ce.commenter_id,
          u.gh_login,
          COUNT(*)::bigint AS value
        FROM comment_events ce
        INNER JOIN "user" u ON u.user_id = ce.commenter_id
        WHERE ce.interaction_time IS NOT NULL
          ${intervalClause}
        GROUP BY ce.commenter_id, u.gh_login
      ),
      human_ranked AS (
        SELECT
          commenter_id,
          value,
          DENSE_RANK() OVER (ORDER BY value DESC) AS rank,
          COUNT(*) OVER () AS rank_out_of
        FROM commenter_summary
        WHERE gh_login NOT LIKE '%[bot]%'
      )
      INSERT INTO computed_user_metrics (
        user_id,
        repository_id,
        metric_key,
        period,
        value,
        rank,
        rank_out_of
      )
      SELECT
        hr.commenter_id,
        ${repositoryId}::bigint,
        ${USER_METRIC_KEYS.PR_COMMENTS_ADDED},
        ${period},
        hr.value,
        hr.rank,
        hr.rank_out_of
      FROM human_ranked hr

      UNION ALL

      SELECT
        cs.commenter_id,
        ${repositoryId}::bigint,
        ${USER_METRIC_KEYS.PR_COMMENTS_ADDED},
        ${period},
        cs.value,
        NULL::integer AS rank,
        NULL::integer AS rank_out_of
      FROM commenter_summary cs
      WHERE cs.gh_login LIKE '%[bot]%'
    `;
  }

  private mapRow(row: RawComputedUserMetricsRow): ComputedUserMetricRecord {
    const insertedAt =
      row.inserted_at instanceof Date
        ? row.inserted_at
        : new Date(row.inserted_at);

    return ComputedUserMetricRecordSchema.parse({
      computedUserMetricsId: Number(row.computed_user_metrics_id),
      userId: Number(row.user_id),
      repositoryId: Number(row.repository_id),
      metricKey: row.metric_key,
      period: row.period,
      value: parseInt(row.value, 10),
      rank: row.rank === null ? null : Number(row.rank),
      rankOutOf: row.rank_out_of === null ? null : Number(row.rank_out_of),
      insertedAt,
    });
  }
}
