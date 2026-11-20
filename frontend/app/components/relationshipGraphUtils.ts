export interface RelationshipEdgeData {
  v: number;
  prs_touched: number;
  total_events: number;
  approvals: number;
  changes_requested: number;
  reviews_with_body: number;
  inline_comments: number;
  convo_comments: number;
  dismissed: number;
}

export interface RelationshipNodeSummary {
  userId: number;
  ghLogin: string;
  totalInWeight: number;
  totalOutWeight: number;
}

export function formatInteger(value: number): string {
  return value.toLocaleString();
}

export function getCommentActivityCount(edgeData: RelationshipEdgeData): number {
  return edgeData.reviews_with_body + edgeData.inline_comments + edgeData.convo_comments;
}

export function getRelationshipMetrics(edgeData: RelationshipEdgeData) {
  return [
    { label: "PRs", value: edgeData.prs_touched },
    { label: "Approvals", value: edgeData.approvals },
    { label: "Comments", value: getCommentActivityCount(edgeData) },
    { label: "Changes", value: edgeData.changes_requested },
  ];
}

export function getNodeScoreContext(
  node: RelationshipNodeSummary,
  allNodes: RelationshipNodeSummary[],
) {
  if (allNodes.length === 0) {
    return { rank: 1, totalNodes: 1, topPercent: 100 };
  }

  const rankedNodes = [...allNodes].sort((a, b) => {
    const scoreDiff = b.totalInWeight + b.totalOutWeight - (a.totalInWeight + a.totalOutWeight);
    return scoreDiff !== 0 ? scoreDiff : a.ghLogin.localeCompare(b.ghLogin);
  });

  const rank = Math.max(
    1,
    rankedNodes.findIndex((candidate) => candidate.userId === node.userId) + 1,
  );
  const totalNodes = rankedNodes.length;
  const topPercent = Math.max(1, Math.ceil((rank / totalNodes) * 100));

  return { rank, totalNodes, topPercent };
}

export function getFeedbackFlowSummary(totalOutWeight: number, totalInWeight: number): string {
  const totalScore = totalOutWeight + totalInWeight;

  if (totalScore === 0) return "No feedback activity yet";

  const sentShare = totalOutWeight / totalScore;
  if (sentShare >= 0.65) return "Mostly gives feedback";
  if (sentShare <= 0.35) return "Mostly receives feedback";

  return "Balanced feedback flow";
}
