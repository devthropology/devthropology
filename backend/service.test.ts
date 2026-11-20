import {
  deepStrictEqual as assertEquals,
  ok as assert,
  rejects as assertRejects,
} from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { Service } from "./service.ts";
import { getTestDatabase } from "./testUtils/testDatabase.ts";
import { RepositoryDetails } from "./models/dbTypes.ts";
import { mockFetch } from "./test/mock_fetch.ts";
import { GithubUserFetchError } from "./models/errors/GithubUserFetchError.ts";

async function getRepositoryIdByName(
  service: Service,
  name: string,
): Promise<number> {
  const repos = await service.getRepositoryDetails();
  const repo = repos.find((r) => r.name === name);

  if (!repo) {
    throw new Error(`Repository with name "${name}" not found.`);
  }

  return repo.repository_id;
}

async function createService(): Promise<Service> {
  const { repository, computedUserMetricsRepository } = await getTestDatabase();
  return new Service(repository, undefined, computedUserMetricsRepository);
}

async function createServiceWithGhApi(): Promise<Service> {
  const { repository, computedUserMetricsRepository, ghApi } =
    await getTestDatabase();
  return new Service(repository, ghApi, computedUserMetricsRepository);
}

describe("Service Layer Tests", () => {
  describe("getRepositoryDetails", () => {
    it("returns typed repository data", async () => {
      const service = await createService();

      const details: RepositoryDetails[] = await service.getRepositoryDetails();

      // Should include at least the tailscale repository
      assertEquals(details.length >= 1, true);
      const tailscaleRepo = details.find(
        (repo) => repo.org === "tailscale" && repo.name === "tailscale",
      );
      assertEquals(tailscaleRepo?.repository_id, 1);
      assertEquals(tailscaleRepo?.org, "tailscale");
      assertEquals(tailscaleRepo?.name, "tailscale");
    });
  });

  describe("getGithubUserProfile", () => {
    it("throws for GitHub 404 responses", async () => {
      const service = await createServiceWithGhApi();
      const username = "not-a-user";
      const originalFetch = globalThis.fetch;

      mockFetch({
        [`https://api.github.com/users/${username}`]: {
          body: { message: "Not Found" },
          status: 404,
        },
      });

      try {
        await assertRejects(
          () => service.getGithubUserProfile(username),
          (error: unknown) =>
            error instanceof GithubUserFetchError &&
            error.message.includes(
              "GitHub user request failed with status 404",
            ),
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("getRepositoryOverview", () => {
    it("handles missing data gracefully", async () => {
      const service = await createService();

      const overview = await service.getRepositoryOverview(999);

      assertEquals(overview, null);
    });

    it("returns overview snapshot for tailscale repository", async () => {
      const service = await createService();
      const repoId = await getRepositoryIdByName(service, "tailscale");

      const overview = await service.getRepositoryOverview(repoId);

      assert(overview?.computedAt);

      const sanitizedOverview = overview
        ? { ...overview, computedAt: "<computedAt>" }
        : overview;

      expect(sanitizedOverview).toMatchSnapshot();
    });
  });

  describe("getDashboardData", () => {
    it("returns dashboard data snapshot for tailscale repository", async () => {
      const service = await createService();
      const repoId = await getRepositoryIdByName(service, "tailscale");

      const data = await service.getDashboardData(
        repoId,
        new Date("2021-03-15"),
        12,
      );

      for (const week of data.volumeMetrics.weeklyTrends) {
        const avgIsValid =
          typeof week.avgContributorAgeDays === "number" ||
          week.avgContributorAgeDays === null;
        const medianIsValid =
          typeof week.medianContributorAgeDays === "number" ||
          week.medianContributorAgeDays === null;
        assertEquals(avgIsValid, true);
        assertEquals(medianIsValid, true);
      }

      expect(data).toMatchSnapshot();
    });

    it("returns dashboard data snapshot for tailscale repository at 2020-05-01", async () => {
      const service = await createService();
      const repoId = await getRepositoryIdByName(service, "tailscale");

      const data = await service.getDashboardData(
        repoId,
        new Date("2020-05-01"),
        12,
      );

      for (const week of data.volumeMetrics.weeklyTrends) {
        const avgIsValid =
          typeof week.avgContributorAgeDays === "number" ||
          week.avgContributorAgeDays === null;
        const medianIsValid =
          typeof week.medianContributorAgeDays === "number" ||
          week.medianContributorAgeDays === null;
        assertEquals(avgIsValid, true);
        assertEquals(medianIsValid, true);
      }

      expect(data).toMatchSnapshot();
    });
  });

  describe("getFileSystemTree", () => {
    it("returns level 1 filesystem tree for tailscale repository", async () => {
      const service = await createService();
      const repoId = await getRepositoryIdByName(service, "tailscale");

      const tree = await service.getFileSystemTree(repoId, "", [1]);

      expect(tree).toMatchSnapshot();
    });

    it("returns level 2 filesystem tree with cmd parent", async () => {
      const service = await createService();
      const repoId = await getRepositoryIdByName(service, "tailscale");

      const tree = await service.getFileSystemTree(repoId, "cmd", [2]);

      expect(tree).toMatchSnapshot();
    });

    it("returns level 3 filesystem tree with cmd/tailscale parent", async () => {
      const service = await createService();
      const repoId = await getRepositoryIdByName(service, "tailscale");

      const tree = await service.getFileSystemTree(
        repoId,
        "cmd/tailscale",
        [3],
      );

      expect(tree).toMatchSnapshot();
    });

    it("returns multiple levels filesystem tree", async () => {
      const service = await createService();
      const repoId = await getRepositoryIdByName(service, "tailscale");

      const tree = await service.getFileSystemTree(repoId, "", [1, 2]);

      expect(tree).toMatchSnapshot();
    });

    it("returns empty tree for non-existent parent path", async () => {
      const service = await createService();
      const repoId = await getRepositoryIdByName(service, "tailscale");

      const tree = await service.getFileSystemTree(
        repoId,
        "non-existent-path",
        [2],
      );

      expect(tree).toMatchSnapshot();
    });
  });

  describe("getFileSystemPRs", () => {
    it("returns PRs for a folder path", async () => {
      const service = await createService();
      const repoId = await getRepositoryIdByName(service, "tailscale");

      const result = await service.getFileSystemPRs(
        repoId,
        "cmd",
        "folder",
        10,
        0,
      );

      expect(result).toMatchSnapshot();
    });

    it("returns PRs for a file path", async () => {
      const service = await createService();
      const repoId = await getRepositoryIdByName(service, "tailscale");

      const result = await service.getFileSystemPRs(
        repoId,
        "go.sum",
        "file",
        10,
        0,
      );

      expect(result).toMatchSnapshot();
    });

    it("returns empty PRs for non-existent path", async () => {
      const service = await createService();
      const repoId = await getRepositoryIdByName(service, "tailscale");

      const result = await service.getFileSystemPRs(
        repoId,
        "non-existent-path",
        "folder",
        10,
        0,
      );

      expect(result).toMatchSnapshot();
    });

    it("respects limit and offset for pagination", async () => {
      const service = await createService();
      const repoId = await getRepositoryIdByName(service, "tailscale");

      const page1 = await service.getFileSystemPRs(
        repoId,
        "cmd",
        "folder",
        2,
        0,
      );
      const page2 = await service.getFileSystemPRs(
        repoId,
        "cmd",
        "folder",
        2,
        2,
      );

      // Pages should not overlap
      const page1Ids = page1.prs.map((pr) => pr.gh_issue_id);
      const page2Ids = page2.prs.map((pr) => pr.gh_issue_id);
      const overlap = page1Ids.filter((id) => page2Ids.includes(id));
      assertEquals(overlap.length, 0);

      // Page 1 should be more recent than page 2
      assertEquals(page1.prs.length, 2);
      assertEquals(page2.prs.length, 2);
      assertEquals(page1.offset, 0);
      assertEquals(page2.offset, 2);

      expect({ page1, page2 }).toMatchSnapshot();
    });
  });

  describe("getUserStatsForUi", () => {
    it("returns user stats for danderson", async () => {
      const service = await createService();
      const repoId = await getRepositoryIdByName(service, "tailscale");

      const stats = await service.getUserStatsForUi("danderson", repoId);

      expect(stats).toMatchSnapshot();
    });

    it("returns user stats for bradfitz", async () => {
      const service = await createService();
      const repoId = await getRepositoryIdByName(service, "tailscale");

      const stats = await service.getUserStatsForUi("bradfitz", repoId);

      expect(stats).toMatchSnapshot();
    });

    it("returns user stats for non-existent user", async () => {
      const service = await createService();
      const repoId = await getRepositoryIdByName(service, "tailscale");

      const stats = await service.getUserStatsForUi("nonexistentuser", repoId);

      expect(stats).toMatchSnapshot();
    });
  });

  describe("getUserPullStats", () => {
    it("returns pull stats for danderson", async () => {
      const service = await createService();
      const repoId = await getRepositoryIdByName(service, "tailscale");

      const pullStats = await service.getUserPullStats("danderson", 25, repoId);

      expect(pullStats).toMatchSnapshot();
    });

    it("returns pull stats for bradfitz", async () => {
      const service = await createService();
      const repoId = await getRepositoryIdByName(service, "tailscale");

      const pullStats = await service.getUserPullStats("bradfitz", 25, repoId);

      expect(pullStats).toMatchSnapshot();
    });

    it("returns empty pulls for non-existent user", async () => {
      const service = await createService();
      const repoId = await getRepositoryIdByName(service, "tailscale");

      const pullStats = await service.getUserPullStats(
        "nonexistentuser",
        25,
        repoId,
      );

      expect(pullStats).toMatchSnapshot();
    });

    it("paginates with offset", async () => {
      const service = await createService();
      const repoId = await getRepositoryIdByName(service, "tailscale");

      const firstPage = await service.getUserPullStats(
        "danderson",
        5,
        repoId,
        0,
      );
      const secondPage = await service.getUserPullStats(
        "danderson",
        5,
        repoId,
        5,
      );

      assertEquals(firstPage.recentPulls.length, 5);
      // Second page should have different items than first page
      const firstPageIds = firstPage.recentPulls.map((p) => p.issueId);
      const secondPageIds = secondPage.recentPulls.map((p) => p.issueId);
      const overlap = firstPageIds.filter((id) => secondPageIds.includes(id));
      assertEquals(overlap.length, 0, "Pages should not overlap");
    });
  });

  describe("getReviewStats", () => {
    it("returns reviewer stats for repository", async () => {
      const service = await createService();
      const repoId = await getRepositoryIdByName(service, "tailscale");

      const stats = await service.getReviewStats(
        new Date("2020-01-01T00:00:00Z"),
        new Date("2022-01-01T00:00:00Z"),
        repoId,
      );

      expect(stats).toMatchSnapshot();
    });

    it("filters reviewer stats for apenwarr", async () => {
      const service = await createService();
      const repoId = await getRepositoryIdByName(service, "tailscale");

      const stats = await service.getReviewStats(
        new Date("2020-01-01T00:00:00Z"),
        new Date("2022-01-01T00:00:00Z"),
        repoId,
        ["apenwarr"],
      );

      expect(stats).toMatchSnapshot();
    });

    it("filters reviewer stats for bradfitz", async () => {
      const service = await createService();
      const repoId = await getRepositoryIdByName(service, "tailscale");

      const stats = await service.getReviewStats(
        new Date("2020-01-01T00:00:00Z"),
        new Date("2022-01-01T00:00:00Z"),
        repoId,
        ["bradfitz"],
      );

      expect(stats).toMatchSnapshot();
    });
  });

  describe("getAuthorStats", () => {
    it("returns author stats for repository", async () => {
      const service = await createService();
      const repoId = await getRepositoryIdByName(service, "tailscale");

      const stats = await service.getAuthorStats(
        new Date("2020-01-01T00:00:00Z"),
        new Date("2022-01-01T00:00:00Z"),
        repoId,
      );

      expect(stats).toMatchSnapshot();
    });

    it("filters author stats for apenwarr", async () => {
      const service = await createService();
      const repoId = await getRepositoryIdByName(service, "tailscale");

      const stats = await service.getAuthorStats(
        new Date("2020-01-01T00:00:00Z"),
        new Date("2022-01-01T00:00:00Z"),
        repoId,
        ["apenwarr"],
      );

      expect(stats).toMatchSnapshot();
    });

    it("filters author stats for bradfitz", async () => {
      const service = await createService();
      const repoId = await getRepositoryIdByName(service, "tailscale");

      const stats = await service.getAuthorStats(
        new Date("2020-01-01T00:00:00Z"),
        new Date("2022-01-01T00:00:00Z"),
        repoId,
        ["bradfitz"],
      );

      expect(stats).toMatchSnapshot();
    });
  });

  describe("getUserReviewStats", () => {
    it("returns review stats for danderson", async () => {
      const service = await createService();
      const repoId = await getRepositoryIdByName(service, "tailscale");

      const reviewStats = await service.getUserReviewStats(
        "danderson",
        50,
        repoId,
      );

      expect(reviewStats).toMatchSnapshot();
    });

    it("returns review stats for bradfitz", async () => {
      const service = await createService();
      const repoId = await getRepositoryIdByName(service, "tailscale");

      const reviewStats = await service.getUserReviewStats(
        "bradfitz",
        50,
        repoId,
      );

      expect(reviewStats).toMatchSnapshot();
    });

    it("returns empty review stats for non-existent user", async () => {
      const service = await createService();
      const repoId = await getRepositoryIdByName(service, "tailscale");

      const reviewStats = await service.getUserReviewStats(
        "nonexistentuser",
        50,
        repoId,
      );

      assertEquals(reviewStats.recentReviews, []);
    });

    it("paginates with offset", async () => {
      const service = await createService();
      const repoId = await getRepositoryIdByName(service, "tailscale");

      const firstPage = await service.getUserReviewStats(
        "danderson",
        5,
        repoId,
        0,
      );
      const secondPage = await service.getUserReviewStats(
        "danderson",
        5,
        repoId,
        5,
      );

      assertEquals(firstPage.recentReviews.length, 5);
      // Second page should have different items than first page
      const firstPageIds = firstPage.recentReviews.map((r) => r.issueId);
      const secondPageIds = secondPage.recentReviews.map((r) => r.issueId);
      const overlap = firstPageIds.filter((id) => secondPageIds.includes(id));
      assertEquals(overlap.length, 0, "Pages should not overlap");
    });
  });

  describe("getUserActivityOverview", () => {
    it("returns user activity overview for tailscale repository", async () => {
      const service = await createService();
      const repoId = await getRepositoryIdByName(service, "tailscale");

      const activity = await service.getUserActivityOverview(repoId);

      expect(activity).toMatchSnapshot();
    });
  });

  describe("getUserMonthlyMetrics", () => {
    it("returns monthly metrics for danderson", async () => {
      const service = await createService();
      const repoId = await getRepositoryIdByName(service, "tailscale");

      const metrics = await service.getUserMonthlyMetrics(repoId, "danderson");

      // Validate structure
      assertEquals(metrics.months.length > 0, true);
      assertEquals(metrics.prsMerged.length, metrics.months.length);
      assertEquals(metrics.linesModified.length, metrics.months.length);
      assertEquals(metrics.prsReviewed.length, metrics.months.length);
      assertEquals(metrics.prCommentsAdded.length, metrics.months.length);

      // Months should be sorted ascending
      const sorted = [...metrics.months].sort();
      assertEquals(metrics.months, sorted);

      // All values should be non-negative
      assertEquals(
        metrics.prsMerged.every((v) => v >= 0),
        true,
      );
      assertEquals(
        metrics.linesModified.every((v) => v >= 0),
        true,
      );
      assertEquals(
        metrics.prsReviewed.every((v) => v >= 0),
        true,
      );
      assertEquals(
        metrics.prCommentsAdded.every((v) => v >= 0),
        true,
      );

      expect(metrics).toMatchSnapshot();
    });

    it("returns monthly metrics for bradfitz", async () => {
      const service = await createService();
      const repoId = await getRepositoryIdByName(service, "tailscale");

      const metrics = await service.getUserMonthlyMetrics(repoId, "bradfitz");

      assertEquals(metrics.months.length > 0, true);
      assertEquals(metrics.prsMerged.length, metrics.months.length);

      expect(metrics).toMatchSnapshot();
    });

    it("returns empty metrics for non-existent user", async () => {
      const service = await createService();
      const repoId = await getRepositoryIdByName(service, "tailscale");

      const metrics = await service.getUserMonthlyMetrics(
        repoId,
        "nonexistentuser",
      );

      assertEquals(metrics.months.length, 0);
      assertEquals(metrics.prsMerged.length, 0);
      assertEquals(metrics.linesModified.length, 0);
      assertEquals(metrics.prsReviewed.length, 0);
      assertEquals(metrics.prCommentsAdded.length, 0);
    });
  });
});
