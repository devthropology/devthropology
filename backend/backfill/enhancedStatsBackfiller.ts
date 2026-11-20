import { computePullRequestEnhancedStats } from "./pullRequestEnhancedStats.ts";
import {
  BackfillPullRequestBatchRow,
  PostgresBackfillRepository,
} from "../repository/postgresBackfillRepository.ts";

type Logger = {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

type EnhancedStatsBackfillerOptions = {
  batchSize?: number;
  progressEvery?: number;
  logger?: Logger;
};

const WRITE_CONCURRENCY = 25;

export class EnhancedStatsBackfiller {
  private readonly batchSize: number;
  private readonly progressEvery: number;
  private readonly logger: Logger;

  constructor(
    private readonly repository: PostgresBackfillRepository,
    options: EnhancedStatsBackfillerOptions = {},
  ) {
    this.batchSize = options.batchSize ?? 100;
    this.progressEvery = options.progressEvery ?? 25;
    this.logger = options.logger ?? console;
  }

  async backfill(org: string, repo: string): Promise<void> {
    const repositoryId = await this.repository.getRepositoryId(org, repo);
    let offset = 0;
    let processed = 0;
    let inserted = 0;
    let updated = 0;
    let failed = 0;
    const failedPullRequests: number[] = [];

    this.logger.log(
      `Starting enhanced PR stats backfill for ${org}/${repo} (batchSize=${this.batchSize}, order=desc)...`,
    );

    while (true) {
      const batch = await this.repository.getClosedPullRequestBatch(
        repositoryId,
        this.batchSize,
        offset,
      );

      if (batch.length === 0) {
        break;
      }

      const issuesByNumber =
        await this.repository.getHydratedIssuesForEnhancedStatsBackfill(
          repositoryId,
          batch.map((row) => row.ghIssueNumber),
        );

      for (let index = 0; index < batch.length; index += WRITE_CONCURRENCY) {
        const writeBatch = batch.slice(index, index + WRITE_CONCURRENCY);
        const results = await Promise.all(
          writeBatch.map(async (batchRow) => {
            try {
              const hydrated = issuesByNumber.get(batchRow.ghIssueNumber);
              if (!hydrated) {
                throw new Error(
                  `Unable to hydrate PR #${batchRow.ghIssueNumber} from database batch`,
                );
              }

              const stats = computePullRequestEnhancedStats(hydrated.issue);
              const writeResult =
                await this.repository.insertPullRequestEnhancedStats({
                  pullRequestId: hydrated.pullRequestId,
                  roundsOfReview: stats.roundsOfReview,
                  botRoundsOfReview: stats.botRoundsOfReview,
                  firstReviewAt: stats.firstReviewAt,
                  firstApprovalAt: stats.firstApprovalAt,
                  firstEffectiveApprovalAt: stats.firstEffectiveApprovalAt,
                  mergedAfterPostApprovalCommit:
                    stats.mergedAfterPostApprovalCommit,
                  aiAssistedModel: stats.aiAssistedModel,
                });

              return { batchRow, writeResult, error: null };
            } catch (error) {
              return { batchRow, writeResult: null, error };
            }
          }),
        );

        for (const result of results) {
          if (result.error) {
            failed++;
            failedPullRequests.push(result.batchRow.ghIssueNumber);
            this.logFailure(result.batchRow, result.error);
          } else if (result.writeResult === "inserted") {
            inserted++;
          } else {
            updated++;
          }

          processed++;
          if (processed % this.progressEvery === 0) {
            this.logProgress({
              processed,
              inserted,
              updated,
              failed,
              batchRow: result.batchRow,
            });
          }
        }
      }

      offset += batch.length;
    }

    this.logger.log(
      `Enhanced PR stats backfill complete for ${org}/${repo}: processed=${processed} inserted=${inserted} updated=${updated} failed=${failed}`,
    );

    if (failedPullRequests.length > 0) {
      this.logger.error(
        `Failed PRs (${failedPullRequests.length}): ${failedPullRequests.join(
          ", ",
        )}`,
      );
    }
  }

  private logProgress({
    processed,
    inserted,
    updated,
    failed,
    batchRow,
  }: {
    processed: number;
    inserted: number;
    updated: number;
    failed: number;
    batchRow: BackfillPullRequestBatchRow;
  }) {
    this.logger.log(
      `processed=${processed} inserted=${inserted} updated=${updated} failed=${failed} current_pr=#${batchRow.ghIssueNumber} created_at=${batchRow.createdAt.toISOString()}`,
    );
  }

  private logFailure(batchRow: BackfillPullRequestBatchRow, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    this.logger.error(
      `Failed enhanced stats backfill for PR #${batchRow.ghIssueNumber} (pull_request_id=${batchRow.pullRequestId}, created_at=${batchRow.createdAt.toISOString()}): ${message}`,
    );
    if (stack) {
      this.logger.error(stack);
    }
  }
}
