import { describe, expect, it } from "vitest";
import {
  getFeedbackFlowSummary,
  getNodeScoreContext,
  getRelationshipMetrics,
} from "./relationshipGraphUtils";

describe("relationshipGraphUtils", () => {
  describe("getFeedbackFlowSummary", () => {
    it("returns no activity when both totals are zero", () => {
      expect(getFeedbackFlowSummary(0, 0)).toBe("No feedback activity yet");
    });

    it("returns mostly gives feedback at the upper boundary", () => {
      expect(getFeedbackFlowSummary(65, 35)).toBe("Mostly gives feedback");
    });

    it("returns mostly receives feedback at the lower boundary", () => {
      expect(getFeedbackFlowSummary(35, 65)).toBe("Mostly receives feedback");
    });

    it("returns balanced feedback flow in the middle", () => {
      expect(getFeedbackFlowSummary(50, 50)).toBe("Balanced feedback flow");
    });
  });

  describe("getNodeScoreContext", () => {
    it("ranks nodes by combined in and out weight", () => {
      const nodes = [
        { userId: 1, ghLogin: "alpha", totalInWeight: 40, totalOutWeight: 10 },
        { userId: 2, ghLogin: "bravo", totalInWeight: 10, totalOutWeight: 10 },
        { userId: 3, ghLogin: "charlie", totalInWeight: 30, totalOutWeight: 20 },
      ];

      expect(getNodeScoreContext(nodes[0], nodes)).toEqual({
        rank: 1,
        totalNodes: 3,
        topPercent: 34,
      });
      expect(getNodeScoreContext(nodes[1], nodes)).toEqual({
        rank: 3,
        totalNodes: 3,
        topPercent: 100,
      });
    });

    it("uses login name as a stable tiebreaker", () => {
      const nodes = [
        { userId: 2, ghLogin: "bravo", totalInWeight: 10, totalOutWeight: 10 },
        { userId: 1, ghLogin: "alpha", totalInWeight: 10, totalOutWeight: 10 },
      ];

      expect(getNodeScoreContext(nodes[1], nodes)).toEqual({
        rank: 1,
        totalNodes: 2,
        topPercent: 50,
      });
      expect(getNodeScoreContext(nodes[0], nodes)).toEqual({
        rank: 2,
        totalNodes: 2,
        topPercent: 100,
      });
    });
  });

  describe("getRelationshipMetrics", () => {
    it("aggregates comment activity and keeps metric order", () => {
      expect(
        getRelationshipMetrics({
          v: 1,
          prs_touched: 12,
          total_events: 0,
          approvals: 8,
          changes_requested: 3,
          reviews_with_body: 4,
          inline_comments: 5,
          convo_comments: 6,
          dismissed: 0,
        }),
      ).toEqual([
        { label: "PRs", value: 12 },
        { label: "Approvals", value: 8 },
        { label: "Comments", value: 15 },
        { label: "Changes", value: 3 },
      ]);
    });
  });
});
