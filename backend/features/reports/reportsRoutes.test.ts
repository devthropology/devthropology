import { test } from "vitest";
import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { Hono } from "hono";
import { encodeRepositoryId } from "../../repositoryPublicId.ts";
import { registerReportsRoutes } from "./reportsRoutes.ts";
import { ReportsService } from "./reportsService.ts";

function setup(
  options: { role?: string; denied?: number; authenticated?: boolean } = {},
) {
  const app = new Hono();
  const calls: { report: string; ids: number[]; start: Date; end: Date }[] = [];
  const accessChecks: number[] = [];
  const service = new ReportsService({
    getAuthorStats: (start, end, ids) => {
      calls.push({ report: "authors", ids, start, end });
      return Promise.resolve([]);
    },
    getReviewerStats: (start, end, ids) => {
      calls.push({ report: "reviewers", ids, start, end });
      return Promise.resolve([]);
    },
  });
  registerReportsRoutes(app, {
    authMiddleware: async (c, next) => {
      if (options.authenticated === false) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      c.set("user", {
        userId: "u1",
        username: "alice",
        role: options.role ?? "superuser",
      });
      await next();
    },
    getReportsService: () => service,
    getWorkspaceRepository: () => ({
      getWorkspaceRepositories: () => Promise.resolve([1, 2]),
    }),
    getAuthorizationService: () => ({
      canAccessRepositoryById: (_user, id) => {
        accessChecks.push(id);
        return Promise.resolve(id !== options.denied);
      },
    }),
  });
  return { app, calls, accessChecks };
}

function url(
  report = "authors",
  ids = [encodeRepositoryId(1), encodeRepositoryId(2)],
) {
  const params = new URLSearchParams({
    workspaceId: "w1",
    startDate: "2026-01-01",
    endDate: "2026-02-01",
  });
  ids.forEach((id) => params.append("repositoryIds", id));
  return `/api/reports/${report}?${params}`;
}

for (const report of ["authors", "reviewers"]) {
  test(`combined ${report}: resolves public IDs, deduplicates, authorizes all and returns existing response shape`, async () => {
    const { app, calls, accessChecks } = setup();
    const response = await app.request(
      url(report, [encodeRepositoryId(2), encodeRepositoryId(1), "2"]),
    );
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("Cache-Control"), "private, no-store");
    const body = await response.json();
    assertEquals(body[report], []);
    assertEquals(body.thresholds.length, 5);
    assertEquals(accessChecks, [1, 2]);
    assertEquals(calls, [
      {
        report,
        ids: [1, 2],
        start: new Date("2026-01-01"),
        end: new Date("2026-02-01"),
      },
    ]);
  });
}

test("combined reports: denies entire selection before querying if any repo is inaccessible", async () => {
  const { app, calls, accessChecks } = setup({ denied: 2 });
  assertEquals((await app.request(url())).status, 403);
  assertEquals(accessChecks, [1, 2]);
  assertEquals(calls.length, 0);
});

for (const role of ["user", "demo"]) {
  for (const report of ["authors", "reviewers"]) {
    test(`combined ${report}: denies ${role} before authorization or querying`, async () => {
      const { app, calls, accessChecks } = setup({ role });
      assertEquals((await app.request(url(report))).status, 403);
      assertEquals(calls.length, 0);
      assertEquals(accessChecks.length, 0);
    });
  }
}

test("combined reports: prevents cross-workspace scope", async () => {
  const foreign = setup();
  assertEquals(
    (await foreign.app.request(url("authors", [encodeRepositoryId(3)]))).status,
    403,
  );
  assertEquals(foreign.calls.length, 0);
});

test("combined reports: requires authentication", async () => {
  const { app, calls } = setup({ authenticated: false });
  assertEquals((await app.request(url())).status, 401);
  assertEquals(calls.length, 0);
});

test("combined reports: validates refs, selection limit, missing dates and actual calendar dates", async () => {
  const { app, calls } = setup();
  for (const path of [
    url("authors", []),
    url("authors", ["!"]),
    url("authors", ["9999999999999999999999"]),
    url(
      "authors",
      Array.from({ length: 21 }, () => encodeRepositoryId(1)),
    ),
    url().replace("2026-01-01", "2026-02-30"),
    url().replace("2026-01-01", "2026-03-01"),
    url().replace("startDate=2026-01-01", "ignored=2026-01-01"),
  ]) {
    const response = await app.request(path);
    assertEquals(response.status, 400, path);
  }
  assertEquals(calls.length, 0);
});
