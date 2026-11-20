import type { ReportsRepository } from "./reportsRepository.ts";
import { buildAuthorStatsResponse } from "../../services/authorStatsCalculator.ts";
import { buildReviewerStatsResponse } from "../../services/reviewerStatsCalculator.ts";

export class ReportsService {
  constructor(
    private repository: Pick<
      ReportsRepository,
      "getAuthorStats" | "getReviewerStats"
    >,
  ) {}

  async getAuthors(repositoryIds: number[], startDate: Date, endDate: Date) {
    return buildAuthorStatsResponse(
      await this.repository.getAuthorStats(startDate, endDate, repositoryIds),
      { includeThresholds: true },
    );
  }

  async getReviewers(repositoryIds: number[], startDate: Date, endDate: Date) {
    return buildReviewerStatsResponse(
      await this.repository.getReviewerStats(startDate, endDate, repositoryIds),
      { includeThresholds: true },
    );
  }
}
