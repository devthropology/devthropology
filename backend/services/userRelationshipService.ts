import {
  RELATIONSHIP_PERIOD,
  type RelationshipGraph,
  type RelationshipPeriod,
  type UserRelationshipRepository,
} from "../repository/userRelationshipRepository.ts";
import { computeRelationshipEdges } from "../repository/relationshipWeighting.ts";

const PERIOD_INTERVAL_MAP: Record<RelationshipPeriod, string | null> = {
  [RELATIONSHIP_PERIOD.ONE_MONTH]: "1 month",
  [RELATIONSHIP_PERIOD.THREE_MONTHS]: "3 months",
  [RELATIONSHIP_PERIOD.ONE_YEAR]: "1 year",
  [RELATIONSHIP_PERIOD.ALL]: null,
};

export class UserRelationshipService {
  private repository: UserRelationshipRepository;

  constructor(repository: UserRelationshipRepository) {
    this.repository = repository;
  }

  async getRelationshipGraph(
    repositoryId: number,
    period: RelationshipPeriod,
    options?: { ghLogin?: string; minWeight?: number },
  ): Promise<RelationshipGraph> {
    return await this.repository.getRelationshipGraph(
      repositoryId,
      period,
      options,
    );
  }

  /**
   * Recompute relationship edges for a repository.
   *
   * 1. Fetch raw events from the database (reviews, comments)
   * 2. Compute weighted edges via pure function
   * 3. Persist: delete old rows + insert new ones in a transaction
   */
  async recomputeForRepository(
    repositoryId: number,
    period: RelationshipPeriod,
  ): Promise<void> {
    const intervalText = PERIOD_INTERVAL_MAP[period];

    // 1. Fetch raw events in parallel
    const [reviews, comments] = await Promise.all([
      this.repository.fetchReviewEvents(repositoryId, intervalText),
      this.repository.fetchCommentEvents(repositoryId, intervalText),
    ]);

    // 2. Compute edges (pure function — no I/O)
    const edges = computeRelationshipEdges({ reviews, comments });

    // 3. Persist
    await this.repository.persistEdges(repositoryId, period, edges);
  }
}
