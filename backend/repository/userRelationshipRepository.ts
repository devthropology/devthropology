import { z } from "zod";
import {
  type CommentEventRow,
  type ComputedEdge,
  type ReviewEventRow,
} from "./relationshipWeighting.ts";

export const RELATIONSHIP_PERIOD = {
  ONE_MONTH: "1mo",
  THREE_MONTHS: "3mo",
  ONE_YEAR: "1yr",
  ALL: "all",
} as const;

export type RelationshipPeriod =
  (typeof RELATIONSHIP_PERIOD)[keyof typeof RELATIONSHIP_PERIOD];

export const RELATIONSHIP_PERIODS: RelationshipPeriod[] =
  Object.values(RELATIONSHIP_PERIOD);

export const EdgeDataV1Schema = z.object({
  v: z.literal(1),
  prs_touched: z.number(),
  total_events: z.number(),
  approvals: z.number(),
  changes_requested: z.number(),
  reviews_with_body: z.number(),
  inline_comments: z.number(),
  convo_comments: z.number(),
  dismissed: z.number(),
});

export type EdgeDataV1 = z.infer<typeof EdgeDataV1Schema>;

export const RelationshipEdgeSchema = z.object({
  repositoryId: z.number(),
  actorUserId: z.number(),
  targetUserId: z.number(),
  period: z.string(),
  edgeWeight: z.number(),
  edgeData: EdgeDataV1Schema,
});

export type RelationshipEdge = z.infer<typeof RelationshipEdgeSchema>;

export const GraphNodeSchema = z.object({
  userId: z.number(),
  ghLogin: z.string(),
  totalInWeight: z.number(),
  totalOutWeight: z.number(),
});

export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphEdgeSchema = z.object({
  fromUserId: z.number(),
  toUserId: z.number(),
  weight: z.number(),
  edgeData: EdgeDataV1Schema,
});

export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const RelationshipGraphSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
});

export type RelationshipGraph = z.infer<typeof RelationshipGraphSchema>;

export interface UserRelationshipRepository {
  close(): Promise<void>;

  /** Fetch raw review events for a repository within an optional time interval. */
  fetchReviewEvents(
    repositoryId: number,
    intervalText: string | null,
  ): Promise<ReviewEventRow[]>;

  /** Fetch raw comment events (inline + conversation) for a repository. */
  fetchCommentEvents(
    repositoryId: number,
    intervalText: string | null,
  ): Promise<CommentEventRow[]>;

  /** Delete old edges and insert new computed edges in a transaction. */
  persistEdges(
    repositoryId: number,
    period: RelationshipPeriod,
    edges: ComputedEdge[],
  ): Promise<void>;

  /** Read the precomputed relationship graph for the API. */
  getRelationshipGraph(
    repositoryId: number,
    period: RelationshipPeriod,
    options?: {
      ghLogin?: string;
      minWeight?: number;
    },
  ): Promise<RelationshipGraph>;
}
