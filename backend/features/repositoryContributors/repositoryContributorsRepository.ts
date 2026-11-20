import { z } from "zod";
import { SqlClient } from "../../repository/sqlClient.ts";
import { RepositoryContributorMonthlyContributorSchema } from "../../../shared/models/repositoryContributors.ts";

const JsonContributorArraySchema = z.preprocess((value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}, z.array(RepositoryContributorMonthlyContributorSchema));

const ComputedRepositoryContributorsRowSchema = z.object({
  repository_id: z.coerce.number(),
  year: z.coerce.number().int(),
  month: z.coerce.number().int().min(1).max(12),
  active_contributors: JsonContributorArraySchema,
  new_contributors: JsonContributorArraySchema,
  churned_contributors: JsonContributorArraySchema,
  computed_at: z
    .union([z.string(), z.date()])
    .transform((date) => (date instanceof Date ? date.toISOString() : date)),
});

export type ComputedRepositoryContributorsRow = z.infer<
  typeof ComputedRepositoryContributorsRowSchema
>;

export class RepositoryContributorsRepository {
  constructor(private readonly sql: SqlClient) {}

  async recomputeForRepository(repositoryId: number): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`
        DELETE FROM computed_repository_contributors
        WHERE repository_id = ${repositoryId}
      `;

      await tx`
        WITH activity_events AS (
          SELECT
            i.user_id,
            i.repository_id,
            i.created_at AS activity_timestamp,
            'issue' AS activity_type
          FROM issue i
          INNER JOIN pull_request pr ON pr.issue_id = i.issue_id
          WHERE i.repository_id = ${repositoryId}
            AND i.issue_type_id = 2
            AND pr.merged_at IS NOT NULL
          UNION ALL
          SELECT
            prc.user_id,
            i.repository_id,
            prc.created_at AS activity_timestamp,
            'comment' AS activity_type
          FROM pull_request_comment prc
          INNER JOIN pull_request pr ON pr.pull_request_id = prc.pull_request_id
          INNER JOIN issue i ON i.issue_id = pr.issue_id
          WHERE i.repository_id = ${repositoryId}
            AND i.issue_type_id = 2
            AND pr.merged_at IS NOT NULL
          UNION ALL
          SELECT
            ic.user_id,
            i.repository_id,
            ic.created_at AS activity_timestamp,
            'comment' AS activity_type
          FROM issue_comment ic
          INNER JOIN issue i ON i.issue_id = ic.issue_id
          INNER JOIN pull_request pr ON pr.issue_id = i.issue_id
          WHERE i.repository_id = ${repositoryId}
            AND i.issue_type_id = 2
            AND pr.merged_at IS NOT NULL
          UNION ALL
          SELECT
            prr.user_id,
            i.repository_id,
            prr.submitted_at AS activity_timestamp,
            'review' AS activity_type
          FROM pull_request_review prr
          INNER JOIN pull_request pr ON pr.pull_request_id = prr.pull_request_id
          INNER JOIN issue i ON i.issue_id = pr.issue_id
          WHERE i.repository_id = ${repositoryId}
            AND i.issue_type_id = 2
            AND pr.merged_at IS NOT NULL
        ),
        valid_activity AS (
          SELECT *
          FROM activity_events
          WHERE activity_timestamp IS NOT NULL
            AND date_trunc('month', activity_timestamp)::date <> '1970-01-01'::date
        ),
        active_by_user_month AS (
          SELECT
            user_id,
            repository_id,
            date_trunc('month', activity_timestamp)::date AS activity_month,
            MAX(activity_timestamp) AS last_active_in_month
          FROM valid_activity
          GROUP BY user_id, repository_id, date_trunc('month', activity_timestamp)::date
        ),
        first_activity AS (
          SELECT DISTINCT ON (user_id, repository_id)
            user_id,
            repository_id,
            activity_timestamp AS first_seen_timestamp
          FROM valid_activity
          ORDER BY user_id, repository_id, activity_timestamp ASC
        ),
        last_activity AS (
          SELECT DISTINCT ON (user_id, repository_id)
            user_id,
            repository_id,
            activity_timestamp AS last_seen_timestamp
          FROM valid_activity
          ORDER BY user_id, repository_id, activity_timestamp DESC
        ),
        month_range AS (
          SELECT activity_month AS month FROM active_by_user_month
          UNION
          SELECT date_trunc('month', first_seen_timestamp)::date AS month FROM first_activity
          UNION
          SELECT date_trunc('month', last_seen_timestamp)::date AS month FROM last_activity
        ),
        active_months AS (
          SELECT
            activity_month AS month,
            jsonb_agg(
              jsonb_build_object(
                'userId', u.user_id,
                'login', u.gh_login,
                'date', abum.last_active_in_month
              )
              ORDER BY abum.last_active_in_month DESC, u.gh_login ASC
            ) AS contributors
          FROM active_by_user_month abum
          INNER JOIN "user" u ON u.user_id = abum.user_id
          GROUP BY activity_month
        ),
        new_months AS (
          SELECT
            date_trunc('month', first_seen_timestamp)::date AS month,
            jsonb_agg(
              jsonb_build_object(
                'userId', u.user_id,
                'login', u.gh_login,
                'date', fa.first_seen_timestamp
              )
              ORDER BY fa.first_seen_timestamp DESC, u.gh_login ASC
            ) AS contributors
          FROM first_activity fa
          INNER JOIN "user" u ON u.user_id = fa.user_id
          GROUP BY date_trunc('month', first_seen_timestamp)::date
        ),
        churned_months AS (
          SELECT
            date_trunc('month', last_seen_timestamp)::date AS month,
            jsonb_agg(
              jsonb_build_object(
                'userId', u.user_id,
                'login', u.gh_login,
                'date', la.last_seen_timestamp
              )
              ORDER BY la.last_seen_timestamp DESC, u.gh_login ASC
            ) AS contributors
          FROM last_activity la
          INNER JOIN "user" u ON u.user_id = la.user_id
          GROUP BY date_trunc('month', last_seen_timestamp)::date
        )
        INSERT INTO computed_repository_contributors (
          repository_id,
          year,
          month,
          active_contributors,
          new_contributors,
          churned_contributors
        )
        SELECT
          ${repositoryId},
          EXTRACT(YEAR FROM mr.month)::integer,
          EXTRACT(MONTH FROM mr.month)::integer,
          COALESCE(am.contributors, '[]'::jsonb),
          COALESCE(nm.contributors, '[]'::jsonb),
          COALESCE(cm.contributors, '[]'::jsonb)
        FROM month_range mr
        LEFT JOIN active_months am ON am.month = mr.month
        LEFT JOIN new_months nm ON nm.month = mr.month
        LEFT JOIN churned_months cm ON cm.month = mr.month
      `;
    });
  }

  async getMonthlyForRepository(
    repositoryId: number,
    startDate?: Date,
  ): Promise<ComputedRepositoryContributorsRow[]> {
    const rows = await this.sql.unsafe(
      `
        SELECT
          repository_id,
          year,
          month,
          active_contributors,
          new_contributors,
          churned_contributors,
          computed_at
        FROM computed_repository_contributors
        WHERE repository_id = $1
          AND make_date(year, month, 1) >= COALESCE($2::date, '-infinity'::date)
        ORDER BY year, month
      `,
      [repositoryId, startDate ?? null],
    );

    return z.array(ComputedRepositoryContributorsRowSchema).parse(rows);
  }
}
