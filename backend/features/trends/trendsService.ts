import type {
  TrendsAiAssistedInsightsResponse,
  TrendsAuthorOutputMonthlyMetrics,
  TrendsInsightsMonthly,
  TrendsInsightsResponse,
  TrendsPrSizeInsightsResponse,
  TrendsPrSizeMonthlyMetrics,
  TrendsPrSizePercentilesResponse,
  TrendsReviewRoundsInsightsResponse,
  TrendsReviewRoundsMonthlyMetrics,
} from "../../../shared/models/trendsInsights.ts";
import {
  AI_SUMMARY_MODEL,
  normalizeAiAssistedModel,
  TrendsRepository,
} from "./trendsRepository.ts";

export class TrendsService {
  constructor(private readonly repository: TrendsRepository) {}

  async getInsights(
    repositoryId: number,
    teamSlug?: string,
  ): Promise<TrendsInsightsResponse> {
    if (!teamSlug) {
      const [computedMonthly, computedBuckets, computedAiRows] =
        await Promise.all([
          this.repository.getComputedMonthly(repositoryId),
          this.repository.getComputedMonthlySizeBuckets(repositoryId),
          this.repository.getComputedMonthlyAiModels(repositoryId),
        ]);

      if (computedMonthly.length > 0) {
        const prSizeDistribution =
          computedBuckets.length > 0
            ? toComputedBucketInsights(computedBuckets)
            : await this.getPrSizeInsights(repositoryId, teamSlug);
        const aiAssisted =
          computedAiRows.length > 0
            ? toComputedAiInsights(computedAiRows)
            : await this.getAiAssistedInsights(repositoryId, teamSlug);

        return this.buildInsightsFromComputedMonthly(
          computedMonthly,
          prSizeDistribution,
          aiAssisted,
        );
      }
    }

    const [reviewRounds, prSizeDistribution, prSize, aiAssisted] =
      await Promise.all([
        this.getReviewRoundsInsights(repositoryId, teamSlug),
        this.getPrSizeInsights(repositoryId, teamSlug),
        this.getPrSizePercentiles(repositoryId, teamSlug),
        this.getAiAssistedInsights(repositoryId, teamSlug),
      ]);

    const monthlyMap = new Map<string, TrendsInsightsMonthly>();

    const getMonthlyEntry = (
      year: number,
      month: number,
    ): TrendsInsightsMonthly => {
      const key = `${year}-${month}`;
      const existing = monthlyMap.get(key);
      if (existing) return existing;

      const created: TrendsInsightsMonthly = {
        year,
        month,
        mergedPrs: null,
        reviewRounds: null,
        prSize: null,
        authorOutput: null,
        prSizeDistribution: { buckets: [] },
        aiAssisted: null,
      };
      monthlyMap.set(key, created);
      return created;
    };

    for (const point of reviewRounds.points) {
      const entry = getMonthlyEntry(point.year, point.month);
      entry.reviewRounds = {
        avgRounds: point.avgRounds,
        avgAllRounds: point.avgAllRounds,
        p50Rounds: point.p50Rounds,
        p75Rounds: point.p75Rounds,
        p90Rounds: point.p90Rounds,
        p95Rounds: point.p95Rounds,
        p99Rounds: point.p99Rounds,
        pctZeroRounds: point.pctZeroRounds,
        pctOneRound: point.pctOneRound,
        pctTwoRounds: point.pctTwoRounds,
        pctThreePlusRounds: point.pctThreePlusRounds,
        pctAnyRound: point.pctAnyRound,
        pctTwoPlusRounds: point.pctTwoPlusRounds,
        pctAnyAllRounds: point.pctAnyAllRounds,
        pctTwoPlusAllRounds: point.pctTwoPlusAllRounds,
        p50TimeToFirstReviewHours: point.p50TimeToFirstReviewHours,
        p75TimeToFirstReviewHours: point.p75TimeToFirstReviewHours,
        p90TimeToFirstReviewHours: point.p90TimeToFirstReviewHours,
        p50TimeToEffectiveApprovalHours: point.p50TimeToEffectiveApprovalHours,
        p75TimeToEffectiveApprovalHours: point.p75TimeToEffectiveApprovalHours,
        p90TimeToEffectiveApprovalHours: point.p90TimeToEffectiveApprovalHours,
      };
    }

    for (const point of prSizeDistribution.points) {
      const entry = getMonthlyEntry(point.year, point.month);
      entry.prSizeDistribution.buckets.push({
        sizeBucket: point.sizeBucket,
        prs: point.prs,
        pctOfMonthPrs: point.pctOfMonthPrs,
        avgRounds: point.avgRounds,
        avgAllRounds: point.avgAllRounds,
        pctZeroRounds: point.pctZeroRounds,
        pctAnyRound: point.pctAnyRound,
        p50TimeToFirstReviewHours: point.p50TimeToFirstReviewHours,
        p75TimeToFirstReviewHours: point.p75TimeToFirstReviewHours,
        p90TimeToFirstReviewHours: point.p90TimeToFirstReviewHours,
        p50TimeToEffectiveApprovalHours: point.p50TimeToEffectiveApprovalHours,
        p75TimeToEffectiveApprovalHours: point.p75TimeToEffectiveApprovalHours,
        p90TimeToEffectiveApprovalHours: point.p90TimeToEffectiveApprovalHours,
      });
    }

    for (const point of prSize.points) {
      const entry = getMonthlyEntry(point.year, point.month);
      entry.mergedPrs = point.mergedPrs;
      entry.prSize = {
        avgPrSize: point.avgPrSize,
        p50PrSize: point.p50PrSize,
        p75PrSize: point.p75PrSize,
        p90PrSize: point.p90PrSize,
      };
    }

    for (const point of prSize.authorOutput.points) {
      const entry = getMonthlyEntry(point.year, point.month);
      entry.authorOutput = {
        activeAuthors: point.activeAuthors,
        avgMergedPrsPerAuthor: point.avgMergedPrsPerAuthor,
        p50MergedPrsPerAuthor: point.p50MergedPrsPerAuthor,
        p75MergedPrsPerAuthor: point.p75MergedPrsPerAuthor,
        p90MergedPrsPerAuthor: point.p90MergedPrsPerAuthor,
        avgLinesChangedPerAuthor: point.avgLinesChangedPerAuthor,
        p50LinesChangedPerAuthor: point.p50LinesChangedPerAuthor,
        p75LinesChangedPerAuthor: point.p75LinesChangedPerAuthor,
        p90LinesChangedPerAuthor: point.p90LinesChangedPerAuthor,
      };
    }

    for (const point of aiAssisted.points) {
      const entry = getMonthlyEntry(point.year, point.month);
      entry.mergedPrs = point.mergedPrs;
      entry.aiAssisted = {
        aiAssistedPrs: point.aiAssistedPrs,
        pctAiAssistedPrs: point.pctAiAssistedPrs,
        models: [],
      };
    }

    for (const point of aiAssisted.modelPoints) {
      const entry = getMonthlyEntry(point.year, point.month);
      if (!entry.aiAssisted) {
        entry.aiAssisted = {
          aiAssistedPrs: 0,
          pctAiAssistedPrs: 0,
          models: [],
        };
      }
      entry.aiAssisted.models.push({
        model: point.model,
        aiAssistedPrs: point.aiAssistedPrs,
        pctAiAssistedPrs: point.pctAiAssistedPrs,
      });
    }

    const monthly = Array.from(monthlyMap.values()).sort((left, right) => {
      if (left.year !== right.year) return left.year - right.year;
      return left.month - right.month;
    });

    return { monthly };
  }

  private buildInsightsFromComputedMonthly(
    computedMonthly: Awaited<
      ReturnType<TrendsRepository["getComputedMonthly"]>
    >,
    prSizeDistribution: TrendsPrSizeInsightsResponse,
    aiAssisted: TrendsAiAssistedInsightsResponse,
  ): TrendsInsightsResponse {
    const monthlyMap = new Map<string, TrendsInsightsMonthly>();

    const getMonthlyEntry = (
      year: number,
      month: number,
    ): TrendsInsightsMonthly => {
      const key = `${year}-${month}`;
      const existing = monthlyMap.get(key);
      if (existing) return existing;

      const created: TrendsInsightsMonthly = {
        year,
        month,
        mergedPrs: null,
        reviewRounds: null,
        prSize: null,
        authorOutput: null,
        prSizeDistribution: { buckets: [] },
        aiAssisted: null,
      };
      monthlyMap.set(key, created);
      return created;
    };

    for (const row of computedMonthly) {
      const entry = getMonthlyEntry(row.year, row.month);
      entry.mergedPrs = row.merged_prs;
      entry.prSize = toPrSizeMetrics(row);
      entry.authorOutput = toAuthorOutputMetrics(row);
      entry.reviewRounds = toReviewRoundsMetrics(row);
    }

    for (const point of prSizeDistribution.points) {
      const entry = getMonthlyEntry(point.year, point.month);
      entry.prSizeDistribution.buckets.push({
        sizeBucket: point.sizeBucket,
        prs: point.prs,
        pctOfMonthPrs: point.pctOfMonthPrs,
        avgRounds: point.avgRounds,
        avgAllRounds: point.avgAllRounds,
        pctZeroRounds: point.pctZeroRounds,
        pctAnyRound: point.pctAnyRound,
        p50TimeToFirstReviewHours: point.p50TimeToFirstReviewHours,
        p75TimeToFirstReviewHours: point.p75TimeToFirstReviewHours,
        p90TimeToFirstReviewHours: point.p90TimeToFirstReviewHours,
        p50TimeToEffectiveApprovalHours: point.p50TimeToEffectiveApprovalHours,
        p75TimeToEffectiveApprovalHours: point.p75TimeToEffectiveApprovalHours,
        p90TimeToEffectiveApprovalHours: point.p90TimeToEffectiveApprovalHours,
      });
    }

    for (const point of aiAssisted.points) {
      const entry = getMonthlyEntry(point.year, point.month);
      entry.mergedPrs = point.mergedPrs;
      entry.aiAssisted = {
        aiAssistedPrs: point.aiAssistedPrs,
        pctAiAssistedPrs: point.pctAiAssistedPrs,
        models: [],
      };
    }

    for (const point of aiAssisted.modelPoints) {
      const entry = getMonthlyEntry(point.year, point.month);
      if (!entry.aiAssisted) {
        entry.aiAssisted = {
          aiAssistedPrs: 0,
          pctAiAssistedPrs: 0,
          models: [],
        };
      }
      entry.aiAssisted.models.push({
        model: point.model,
        aiAssistedPrs: point.aiAssistedPrs,
        pctAiAssistedPrs: point.pctAiAssistedPrs,
      });
    }

    const monthly = Array.from(monthlyMap.values()).sort((left, right) => {
      if (left.year !== right.year) return left.year - right.year;
      return left.month - right.month;
    });

    return { monthly };
  }

  async getReviewRoundsInsights(
    repositoryId: number,
    teamSlug?: string,
  ): Promise<TrendsReviewRoundsInsightsResponse> {
    return await this.repository.getReviewRoundsInsights(
      repositoryId,
      teamSlug,
    );
  }

  async getPrSizeInsights(
    repositoryId: number,
    teamSlug?: string,
  ): Promise<TrendsPrSizeInsightsResponse> {
    return await this.repository.getPrSizeInsights(repositoryId, teamSlug);
  }

  async getPrSizePercentiles(
    repositoryId: number,
    teamSlug?: string,
  ): Promise<TrendsPrSizePercentilesResponse> {
    return await this.repository.getPrSizePercentiles(repositoryId, teamSlug);
  }

  async getAiAssistedInsights(
    repositoryId: number,
    teamSlug?: string,
  ): Promise<TrendsAiAssistedInsightsResponse> {
    return await this.repository.getAiAssistedInsights(repositoryId, teamSlug);
  }
}

function toComputedBucketInsights(
  computedBuckets: Awaited<
    ReturnType<TrendsRepository["getComputedMonthlySizeBuckets"]>
  >,
): TrendsPrSizeInsightsResponse {
  return {
    points: computedBuckets.map((row) => ({
      year: row.year,
      month: row.month,
      sizeBucket:
        row.size_bucket as TrendsPrSizeInsightsResponse["points"][number]["sizeBucket"],
      prs: row.prs ?? 0,
      pctOfMonthPrs: row.pct_of_month_prs ?? 0,
      avgRounds: row.avg_rounds,
      avgAllRounds: row.avg_all_rounds,
      pctZeroRounds: row.pct_zero_rounds,
      pctAnyRound: row.pct_any_round,
      p50TimeToFirstReviewHours: row.p50_time_to_first_review_hours,
      p75TimeToFirstReviewHours: row.p75_time_to_first_review_hours,
      p90TimeToFirstReviewHours: row.p90_time_to_first_review_hours,
      p50TimeToEffectiveApprovalHours: row.p50_time_to_effective_approval_hours,
      p75TimeToEffectiveApprovalHours: row.p75_time_to_effective_approval_hours,
      p90TimeToEffectiveApprovalHours: row.p90_time_to_effective_approval_hours,
    })),
  };
}

function toComputedAiInsights(
  computedAiRows: Awaited<
    ReturnType<TrendsRepository["getComputedMonthlyAiModels"]>
  >,
): TrendsAiAssistedInsightsResponse {
  const summaryPoints: TrendsAiAssistedInsightsResponse["points"] = [];
  const hydratedPointMap = new Map<
    string,
    TrendsAiAssistedInsightsResponse["modelPoints"][number]
  >();

  for (const row of computedAiRows) {
    if (row.model === AI_SUMMARY_MODEL) {
      summaryPoints.push({
        year: row.year,
        month: row.month,
        mergedPrs: row.merged_prs ?? 0,
        aiAssistedPrs: row.ai_assisted_prs ?? 0,
        pctAiAssistedPrs: row.pct_ai_assisted_prs ?? 0,
      });
      continue;
    }

    const model = normalizeAiAssistedModel(row.model);
    const mapKey = `${row.year}-${row.month}-${model}`;
    const existing = hydratedPointMap.get(mapKey);

    if (existing) {
      existing.aiAssistedPrs += row.ai_assisted_prs ?? 0;
      existing.pctAiAssistedPrs = Number(
        (
          (existing.aiAssistedPrs / Math.max(existing.mergedPrs, 1)) *
          100
        ).toFixed(1),
      );
      continue;
    }

    hydratedPointMap.set(mapKey, {
      year: row.year,
      month: row.month,
      model,
      mergedPrs: row.merged_prs ?? 0,
      aiAssistedPrs: row.ai_assisted_prs ?? 0,
      pctAiAssistedPrs: row.pct_ai_assisted_prs ?? 0,
    });
  }

  return {
    points: summaryPoints.sort((left, right) => {
      if (left.year !== right.year) return left.year - right.year;
      return left.month - right.month;
    }),
    modelPoints: Array.from(hydratedPointMap.values()).sort((left, right) => {
      if (left.year !== right.year) return left.year - right.year;
      if (left.month !== right.month) return left.month - right.month;
      return left.model.localeCompare(right.model);
    }),
  };
}

function toPrSizeMetrics(
  row: Awaited<ReturnType<TrendsRepository["getComputedMonthly"]>>[number],
): TrendsPrSizeMonthlyMetrics | null {
  if (
    row.avg_pr_size === null &&
    row.p50_pr_size === null &&
    row.p75_pr_size === null &&
    row.p90_pr_size === null
  ) {
    return null;
  }

  return {
    avgPrSize: row.avg_pr_size,
    p50PrSize: row.p50_pr_size,
    p75PrSize: row.p75_pr_size,
    p90PrSize: row.p90_pr_size,
  };
}

function toAuthorOutputMetrics(
  row: Awaited<ReturnType<TrendsRepository["getComputedMonthly"]>>[number],
): TrendsAuthorOutputMonthlyMetrics | null {
  if (
    row.active_authors === null &&
    row.avg_merged_prs_per_author === null &&
    row.p50_merged_prs_per_author === null &&
    row.p75_merged_prs_per_author === null &&
    row.p90_merged_prs_per_author === null &&
    row.avg_lines_changed_per_author === null &&
    row.p50_lines_changed_per_author === null &&
    row.p75_lines_changed_per_author === null &&
    row.p90_lines_changed_per_author === null
  ) {
    return null;
  }

  return {
    activeAuthors: row.active_authors ?? 0,
    avgMergedPrsPerAuthor: row.avg_merged_prs_per_author,
    p50MergedPrsPerAuthor: row.p50_merged_prs_per_author,
    p75MergedPrsPerAuthor: row.p75_merged_prs_per_author,
    p90MergedPrsPerAuthor: row.p90_merged_prs_per_author,
    avgLinesChangedPerAuthor: row.avg_lines_changed_per_author,
    p50LinesChangedPerAuthor: row.p50_lines_changed_per_author,
    p75LinesChangedPerAuthor: row.p75_lines_changed_per_author,
    p90LinesChangedPerAuthor: row.p90_lines_changed_per_author,
  };
}

function toReviewRoundsMetrics(
  row: Awaited<ReturnType<TrendsRepository["getComputedMonthly"]>>[number],
): TrendsReviewRoundsMonthlyMetrics | null {
  if (
    row.avg_rounds === null &&
    row.avg_all_rounds === null &&
    row.p50_rounds === null &&
    row.p75_rounds === null &&
    row.p90_rounds === null &&
    row.p95_rounds === null &&
    row.p99_rounds === null &&
    row.pct_zero_rounds === null &&
    row.pct_one_round === null &&
    row.pct_two_rounds === null &&
    row.pct_three_plus_rounds === null &&
    row.pct_any_round === null &&
    row.pct_two_plus_rounds === null &&
    row.pct_any_all_rounds === null &&
    row.pct_two_plus_all_rounds === null &&
    row.p50_time_to_first_review_hours === null &&
    row.p75_time_to_first_review_hours === null &&
    row.p90_time_to_first_review_hours === null &&
    row.p50_time_to_effective_approval_hours === null &&
    row.p75_time_to_effective_approval_hours === null &&
    row.p90_time_to_effective_approval_hours === null
  ) {
    return null;
  }

  return {
    avgRounds: row.avg_rounds,
    avgAllRounds: row.avg_all_rounds,
    p50Rounds: row.p50_rounds,
    p75Rounds: row.p75_rounds,
    p90Rounds: row.p90_rounds,
    p95Rounds: row.p95_rounds,
    p99Rounds: row.p99_rounds,
    pctZeroRounds: row.pct_zero_rounds,
    pctOneRound: row.pct_one_round,
    pctTwoRounds: row.pct_two_rounds,
    pctThreePlusRounds: row.pct_three_plus_rounds,
    pctAnyRound: row.pct_any_round,
    pctTwoPlusRounds: row.pct_two_plus_rounds,
    pctAnyAllRounds: row.pct_any_all_rounds,
    pctTwoPlusAllRounds: row.pct_two_plus_all_rounds,
    p50TimeToFirstReviewHours: row.p50_time_to_first_review_hours,
    p75TimeToFirstReviewHours: row.p75_time_to_first_review_hours,
    p90TimeToFirstReviewHours: row.p90_time_to_first_review_hours,
    p50TimeToEffectiveApprovalHours: row.p50_time_to_effective_approval_hours,
    p75TimeToEffectiveApprovalHours: row.p75_time_to_effective_approval_hours,
    p90TimeToEffectiveApprovalHours: row.p90_time_to_effective_approval_hours,
  };
}
