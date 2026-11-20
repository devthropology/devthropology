import {
  EdgeDataV1,
  GraphEdge,
  GraphNode,
  RelationshipGraph,
  RelationshipPeriod,
  UserRelationshipRepository,
} from "./userRelationshipRepository.ts";
import { SqlClient } from "./sqlClient.ts";
import {
  type CommentEventRow,
  type ComputedEdge,
  type ReviewEventRow,
} from "./relationshipWeighting.ts";

type Sql = SqlClient;

const MAX_PG_PARAMS = 65535;
const RELATIONSHIP_INSERT_COLUMNS = 6;

type PersistedEdgeRow = {
  repository_id: number;
  actor_user_id: number;
  target_user_id: number;
  period: RelationshipPeriod;
  edge_weight: number;
  edge_data: string;
};

type RawGraphRow = {
  actor_user_id: number | string;
  actor_gh_login: string;
  target_user_id: number | string;
  target_gh_login: string;
  edge_weight: number | string;
  edge_data: EdgeDataV1 | string;
};

export class PostgresUserRelationshipRepository implements UserRelationshipRepository {
  private readonly sql: SqlClient;

  constructor(sql: SqlClient) {
    this.sql = sql;
  }

  async close(): Promise<void> {
    // No-op: caller owns SqlClient lifecycle
  }

  // -- Raw event queries -------------------------------------------------

  async fetchReviewEvents(
    repositoryId: number,
    intervalText: string | null,
  ): Promise<ReviewEventRow[]> {
    const intervalClause =
      intervalText === null
        ? this.sql``
        : this.sql`AND i.created_at >= NOW() - (${intervalText}::interval)`;

    return await this.sql<ReviewEventRow[]>`
      SELECT
        prr.user_id AS actor_id,
        i.user_id AS author_id,
        pr.pull_request_id,
        prr.state,
        (prr.body IS NOT NULL AND prr.body <> '') AS has_body
      FROM pull_request_review prr
      JOIN pull_request pr ON pr.pull_request_id = prr.pull_request_id
      JOIN issue i ON i.issue_id = pr.issue_id
      JOIN "user" u ON u.user_id = prr.user_id
      WHERE i.repository_id = ${repositoryId}
        AND i.issue_type_id = 2
        AND prr.user_id <> i.user_id
        AND u.gh_login NOT LIKE '%[bot]%'
        ${intervalClause}
    `;
  }

  async fetchCommentEvents(
    repositoryId: number,
    intervalText: string | null,
  ): Promise<CommentEventRow[]> {
    const intervalClause =
      intervalText === null
        ? this.sql``
        : this.sql`AND i.created_at >= NOW() - (${intervalText}::interval)`;

    return await this.sql<CommentEventRow[]>`
      SELECT actor_id, author_id, pull_request_id, comment_type
      FROM (
        SELECT
          prc.user_id AS actor_id,
          i.user_id AS author_id,
          pr.pull_request_id,
          'inline' AS comment_type
        FROM pull_request_comment prc
        JOIN pull_request pr ON pr.pull_request_id = prc.pull_request_id
        JOIN issue i ON i.issue_id = pr.issue_id
        JOIN "user" u ON u.user_id = prc.user_id
        WHERE i.repository_id = ${repositoryId}
          AND i.issue_type_id = 2
          AND prc.user_id <> i.user_id
          AND u.gh_login NOT LIKE '%[bot]%'
          ${intervalClause}

        UNION ALL

        SELECT
          ic.user_id AS actor_id,
          i.user_id AS author_id,
          pr.pull_request_id,
          'conversation' AS comment_type
        FROM issue_comment ic
        JOIN issue i ON i.issue_id = ic.issue_id
        JOIN pull_request pr ON pr.issue_id = i.issue_id
        JOIN "user" u ON u.user_id = ic.user_id
        WHERE i.repository_id = ${repositoryId}
          AND i.issue_type_id = 2
          AND ic.user_id <> i.user_id
          AND u.gh_login NOT LIKE '%[bot]%'
          ${intervalClause}
      ) comments
    `;
  }

  // -- Persist computed edges --------------------------------------------

  async persistEdges(
    repositoryId: number,
    period: RelationshipPeriod,
    edges: ComputedEdge[],
  ): Promise<void> {
    await this.sql.begin(async (tx: Sql) => {
      await tx`
        DELETE FROM computed_user_relationship
        WHERE repository_id = ${repositoryId}
          AND period = ${period}
      `;

      if (edges.length === 0) return;

      const rows: PersistedEdgeRow[] = edges.map((edge) => ({
        repository_id: repositoryId,
        actor_user_id: edge.actorId,
        target_user_id: edge.targetId,
        period,
        edge_weight: edge.edgeWeight,
        edge_data: JSON.stringify(edge.edgeData),
      }));

      await this.insertEdgesInBatches(tx, rows);
    });
  }

  private async insertEdgesInBatches(
    tx: Sql,
    rows: PersistedEdgeRow[],
  ): Promise<void> {
    const maxBatchSize = Math.max(
      1,
      Math.floor(MAX_PG_PARAMS / RELATIONSHIP_INSERT_COLUMNS),
    );

    for (let offset = 0; offset < rows.length; offset += maxBatchSize) {
      const batch = rows.slice(offset, offset + maxBatchSize);
      const values = batch.flatMap((row) => [
        row.repository_id,
        row.actor_user_id,
        row.target_user_id,
        row.period,
        row.edge_weight,
        row.edge_data,
      ]);
      const placeholders = batch
        .map((_, index) => {
          const base = index * RELATIONSHIP_INSERT_COLUMNS;
          return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${
            base + 5
          },$${base + 6})`;
        })
        .join(",");

      await tx.unsafe(
        `
          INSERT INTO computed_user_relationship (
            repository_id,
            actor_user_id,
            target_user_id,
            period,
            edge_weight,
            edge_data
          )
          VALUES ${placeholders}
        `,
        values,
      );
    }
  }

  // -- Read side ---------------------------------------------------------

  async getRelationshipGraph(
    repositoryId: number,
    period: RelationshipPeriod,
    options?: {
      ghLogin?: string;
      minWeight?: number;
    },
  ): Promise<RelationshipGraph> {
    const ghLogin = options?.ghLogin;
    const minWeight = options?.minWeight ?? 0;

    let rows: RawGraphRow[];

    if (ghLogin) {
      rows = await this.sql<RawGraphRow[]>`
        SELECT
          cur.actor_user_id,
          ua.gh_login AS actor_gh_login,
          cur.target_user_id,
          ut.gh_login AS target_gh_login,
          cur.edge_weight,
          cur.edge_data
        FROM computed_user_relationship cur
        JOIN "user" ua ON ua.user_id = cur.actor_user_id
        JOIN "user" ut ON ut.user_id = cur.target_user_id
        WHERE cur.repository_id = ${repositoryId}
          AND cur.period = ${period}
          AND cur.edge_weight >= ${minWeight}
          AND (ua.gh_login = ${ghLogin} OR ut.gh_login = ${ghLogin})
        ORDER BY cur.edge_weight DESC
      `;
    } else {
      rows = await this.sql<RawGraphRow[]>`
        SELECT
          cur.actor_user_id,
          ua.gh_login AS actor_gh_login,
          cur.target_user_id,
          ut.gh_login AS target_gh_login,
          cur.edge_weight,
          cur.edge_data
        FROM computed_user_relationship cur
        JOIN "user" ua ON ua.user_id = cur.actor_user_id
        JOIN "user" ut ON ut.user_id = cur.target_user_id
        WHERE cur.repository_id = ${repositoryId}
          AND cur.period = ${period}
          AND cur.edge_weight >= ${minWeight}
        ORDER BY cur.edge_weight DESC
      `;
    }

    return this.buildGraph(rows);
  }

  private buildGraph(rows: RawGraphRow[]): RelationshipGraph {
    const nodeMap = new Map<
      number,
      {
        userId: number;
        ghLogin: string;
        totalInWeight: number;
        totalOutWeight: number;
      }
    >();

    const edges: GraphEdge[] = [];

    for (const row of rows) {
      const actorUserId = Number(row.actor_user_id);
      const targetUserId = Number(row.target_user_id);
      const weight = Number(row.edge_weight);
      const edgeData: EdgeDataV1 =
        typeof row.edge_data === "string"
          ? JSON.parse(row.edge_data)
          : row.edge_data;

      if (!nodeMap.has(actorUserId)) {
        nodeMap.set(actorUserId, {
          userId: actorUserId,
          ghLogin: row.actor_gh_login,
          totalInWeight: 0,
          totalOutWeight: 0,
        });
      }
      if (!nodeMap.has(targetUserId)) {
        nodeMap.set(targetUserId, {
          userId: targetUserId,
          ghLogin: row.target_gh_login,
          totalInWeight: 0,
          totalOutWeight: 0,
        });
      }

      nodeMap.get(actorUserId)!.totalOutWeight += weight;
      nodeMap.get(targetUserId)!.totalInWeight += weight;

      edges.push({
        fromUserId: actorUserId,
        toUserId: targetUserId,
        weight,
        edgeData,
      });
    }

    const nodes: GraphNode[] = Array.from(nodeMap.values());

    return { nodes, edges };
  }
}
