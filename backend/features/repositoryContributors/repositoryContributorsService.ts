import { startOfMonth, subMonths } from "date-fns";
import type {
  RepositoryContributorMonthlyContributor,
  RepositoryContributorsMonthlyResponse,
} from "../../../shared/models/repositoryContributors.ts";
import { RepositoryContributorsRepository } from "./repositoryContributorsRepository.ts";

export class RepositoryContributorsService {
  constructor(private readonly repository: RepositoryContributorsRepository) {}

  async getMonthly(
    repositoryId: number,
    months: number,
  ): Promise<RepositoryContributorsMonthlyResponse> {
    if (!Number.isFinite(months) || months <= 0) {
      throw new Error("months must be a positive integer");
    }

    const monthsCount = Math.floor(months);
    const now = new Date();
    const startDate =
      months >= Number.MAX_SAFE_INTEGER
        ? undefined
        : startOfMonth(subMonths(now, monthsCount - 1));

    const rows = await this.repository.getMonthlyForRepository(
      repositoryId,
      startDate,
    );
    const sortedRows = [...rows].sort((left, right) =>
      left.year === right.year
        ? left.month - right.month
        : left.year - right.year,
    );
    const visibleRows =
      monthsCount >= sortedRows.length
        ? sortedRows
        : sortedRows.slice(-monthsCount);

    return {
      months: visibleRows.map((row) => ({
        year: row.year,
        month: row.month,
        active: toBucket(row.active_contributors),
        new: toBucket(row.new_contributors),
        churned: toBucket(row.churned_contributors),
      })),
    };
  }
}

function toBucket(contributors: RepositoryContributorMonthlyContributor[]) {
  return {
    count: contributors.length,
    contributors,
  };
}
