import { z } from "zod";
import {
  AuthorStatsSchema,
  ReviewerStatsSchema,
} from "../../models/dbTypes.ts";
import {
  getAuthorStats,
  getReviewStats,
  getReviewStatsForUsers,
} from "../../repository/postgresQueries.ts";
import type { SqlClient } from "../../repository/sqlClient.ts";

/** Shared query implementation for single-repository and combined reports. */
export class ReportsRepository {
  constructor(private sql: SqlClient) {}

  async getAuthorStats(
    startDate: Date,
    endDate: Date,
    repositoryIds: number[],
    usernames?: string[],
  ) {
    const ids = [...new Set(repositoryIds)];
    if (!ids.length) return [];
    const rows = await this.sql.unsafe(getAuthorStats, [
      ids,
      startDate,
      endDate,
      usernames ?? null,
    ]);
    return z.array(AuthorStatsSchema).parse(rows);
  }

  async getReviewerStats(
    startDate: Date,
    endDate: Date,
    repositoryIds: number[],
    usernames?: string[],
  ) {
    const ids = [...new Set(repositoryIds)];
    if (!ids.length) return [];
    const rows = usernames?.length
      ? await this.sql.unsafe(getReviewStatsForUsers, [
          ids,
          startDate,
          endDate,
          usernames,
        ])
      : await this.sql.unsafe(getReviewStats, [ids, startDate, endDate]);
    return z.array(ReviewerStatsSchema).parse(rows);
  }
}
