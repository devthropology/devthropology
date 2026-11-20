import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { PostgresUserRelationshipRepository } from "../repository/postgresUserRelationshipRepository.ts";
import { createSqlClient } from "../repository/sqlClient.ts";
import { UserRelationshipService } from "./userRelationshipService.ts";
import { getTestDatabase } from "../testUtils/testDatabase.ts";

async function getRepositoryIdByName(name: string): Promise<number> {
  const { repository } = await getTestDatabase();
  const repos = await repository.getRepositoryDetails();
  const repo = repos.find((r) => r.name === name);

  if (!repo) {
    throw new Error(`Repository with name "${name}" not found.`);
  }

  return repo.repository_id;
}

async function createUserRelationshipService(): Promise<UserRelationshipService> {
  const { connectionString } = await getTestDatabase();
  const userRelationshipRepository = new PostgresUserRelationshipRepository(
    createSqlClient(connectionString),
  );
  return new UserRelationshipService(userRelationshipRepository);
}

function sortGraph(
  graph: Awaited<ReturnType<UserRelationshipService["getRelationshipGraph"]>>,
) {
  return {
    nodes: [...graph.nodes].sort((a, b) => a.userId - b.userId),
    edges: [...graph.edges].sort(
      (a, b) => a.fromUserId - b.fromUserId || a.toUserId - b.toUserId,
    ),
  };
}

describe("UserRelationshipService", () => {
  describe("getRelationshipGraph", () => {
    it("returns relationship graph snapshot for tailscale repository", async () => {
      const service = await createUserRelationshipService();
      const repoId = await getRepositoryIdByName("tailscale");

      // Test data is from 2020-2021, so relative windows like "3mo" return nothing.
      const graph = await service.getRelationshipGraph(repoId, "all");

      assertEquals(graph.nodes.length > 0, true);
      assertEquals(graph.edges.length > 0, true);

      expect(sortGraph(graph)).toMatchSnapshot();
    });

    it("returns empty graph for non-existent repository", async () => {
      const service = await createUserRelationshipService();

      const graph = await service.getRelationshipGraph(999, "all");

      assertEquals(graph.nodes.length, 0);
      assertEquals(graph.edges.length, 0);

      expect(graph).toMatchSnapshot();
    });

    it("returns filtered graph with minWeight", async () => {
      const service = await createUserRelationshipService();
      const repoId = await getRepositoryIdByName("tailscale");

      const graph = await service.getRelationshipGraph(repoId, "all", {
        minWeight: 5,
      });

      for (const edge of graph.edges) {
        assertEquals(edge.weight >= 5, true);
      }

      expect(sortGraph(graph)).toMatchSnapshot();
    });
  });
});
