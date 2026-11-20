import { test } from "vitest";
import {
  deepStrictEqual as assertEquals,
  ok as assert,
  rejects as assertRejects,
} from "node:assert/strict";
import { GhApi } from "./ghApi.ts";
import {
  GithubResponseParseError,
  GithubResponseShapeError,
  GithubResponseStatusError,
} from "../models/errors/githubResponseErrors.ts";
import { RateExceededError } from "../models/errors/RateExceededError.ts";
import { mockFetch } from "../test/mock_fetch.ts";

const owner = "posthog";
const repo = "posthog";
const issueNumber = 46113;
const issueUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`;
const pullUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${issueNumber}`;

test("GhApi getIssue includes endpoint, status, response, and zod error for malformed payload", async () => {
  const payload = { message: "temporary GitHub hiccup" };
  mockFetch({
    [issueUrl]: {
      body: payload,
      status: 200,
    },
  });

  const api = new GhApi(owner, repo, "user", "token");
  await assertRejects(
    () => api.getIssue(issueNumber),
    (error: unknown) => {
      assert(error instanceof GithubResponseParseError);
      assertEquals(error.endpoint, issueUrl);
      assertEquals(error.status, 200);
      assertEquals(error.response, payload);
      assertEquals(error.cause, error.zodError);
      assert(error.message.includes("BasicIssueSchema"));
      assert(error.message.includes(issueUrl));
      assert(error.message.includes(JSON.stringify(payload)));
      assert(error.zodError.issues.some((issue) => issue.path[0] === "user"));
      const logPayload = JSON.stringify(error);
      assert(logPayload.includes("GithubResponseParseError"));
      assert(logPayload.includes(issueUrl));
      assert(logPayload.includes(JSON.stringify(payload)));
      return true;
    },
  );
});

test("GhApi getFullIssue includes pull endpoint and response for malformed pull payload", async () => {
  const payload = { message: "pull endpoint returned a non-pull payload" };
  mockFetch({
    [issueUrl]: {
      body: closedPullRequestIssue(),
      status: 200,
    },
    [pullUrl]: {
      body: payload,
      status: 200,
    },
  });

  const api = new GhApi(owner, repo, "user", "token");

  await assertRejects(
    () => api.getFullIssue(issueNumber),
    (error: unknown) => {
      assert(error instanceof GithubResponseParseError);
      assertEquals(error.endpoint, pullUrl);
      assertEquals(error.status, 200);
      assertEquals(error.response, payload);
      assertEquals(error.cause, error.zodError);
      assert(error.message.includes("PullRequestSchema"));
      assert(error.message.includes(pullUrl));
      assert(error.message.includes(JSON.stringify(payload)));
      const logPayload = JSON.stringify(error);
      assert(logPayload.includes("GithubResponseParseError"));
      assert(logPayload.includes(pullUrl));
      assert(logPayload.includes(JSON.stringify(payload)));
      return true;
    },
  );
});

test("GhApi paginated PR components include endpoint, status, and response for non-array payload", async () => {
  const filesUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${issueNumber}/files?per_page=100&page=1`;
  const payload = { message: "API returned an object instead of a list" };
  mockFetch({
    [filesUrl]: {
      body: payload,
      status: 200,
    },
  });

  const api = new GhApi(owner, repo, "user", "token");

  await assertRejects(
    () => api.getPullRequestFilesById(issueNumber),
    (error: unknown) => {
      assert(error instanceof GithubResponseShapeError);
      assertEquals(error.endpoint, filesUrl);
      assertEquals(error.status, 200);
      assertEquals(error.response, payload);
      assert(error.message.includes("expected array"));
      assert(error.message.includes(filesUrl));
      assert(error.message.includes(JSON.stringify(payload)));
      const logPayload = JSON.stringify(error);
      assert(logPayload.includes("GithubResponseShapeError"));
      assert(logPayload.includes(filesUrl));
      assert(logPayload.includes(JSON.stringify(payload)));
      return true;
    },
  );
});

test("GhApi paginated PR components include endpoint, status, and response for non-OK payload", async () => {
  const filesUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${issueNumber}/files?per_page=100&page=1`;
  const payload = { message: "GitHub is unavailable" };
  mockFetch({
    [filesUrl]: {
      body: payload,
      status: 500,
    },
  });

  const api = new GhApi(owner, repo, "user", "token");

  await assertRejects(
    () => api.getPullRequestFilesById(issueNumber),
    (error: unknown) => {
      assert(error instanceof GithubResponseStatusError);
      assertEquals(error.endpoint, filesUrl);
      assertEquals(error.status, 500);
      assertEquals(error.response, payload);
      assert(error.message.includes(filesUrl));
      assert(error.message.includes(JSON.stringify(payload)));
      return true;
    },
  );
});

test("GhApi paginated PR components throw RateExceededError for 403 responses", async () => {
  const filesUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${issueNumber}/files?per_page=100&page=1`;
  mockFetch({
    [filesUrl]: {
      body: {
        message: "API rate limit exceeded",
        status: "403",
      },
      status: 403,
    },
  });

  const api = new GhApi(owner, repo, "user", "token");

  await assertRejects(
    () => api.getPullRequestFilesById(issueNumber),
    RateExceededError,
  );
});

test("GhApi collections throw RateExceededError for 403 responses", async () => {
  const teamsUrl = `https://api.github.com/orgs/${owner}/teams?per_page=100&page=1`;
  mockFetch({
    [teamsUrl]: {
      body: {
        message: "API rate limit exceeded",
        status: "403",
      },
      status: 403,
    },
  });

  const api = new GhApi(owner, repo, "user", "token");

  await assertRejects(() => api.getOrgTeams(owner), RateExceededError);
});

test("GhApi collections include endpoint, status, and response for non-array payload", async () => {
  const teamsUrl = `https://api.github.com/orgs/${owner}/teams?per_page=100&page=1`;
  const payload = { message: "API returned an object instead of a list" };
  mockFetch({
    [teamsUrl]: {
      body: payload,
      status: 200,
    },
  });

  const api = new GhApi(owner, repo, "user", "token");

  await assertRejects(
    () => api.getOrgTeams(owner),
    (error: unknown) => {
      assert(error instanceof GithubResponseShapeError);
      assertEquals(error.endpoint, teamsUrl);
      assertEquals(error.status, 200);
      assertEquals(error.response, payload);
      assert(error.message.includes("expected array"));
      assert(error.message.includes(teamsUrl));
      assert(error.message.includes(JSON.stringify(payload)));
      return true;
    },
  );
});

test("GhApi collections include endpoint, status, and response for non-OK payload", async () => {
  const teamsUrl = `https://api.github.com/orgs/${owner}/teams?per_page=100&page=1`;
  const payload = { message: "GitHub is unavailable" };
  mockFetch({
    [teamsUrl]: {
      body: payload,
      status: 500,
    },
  });

  const api = new GhApi(owner, repo, "user", "token");

  await assertRejects(
    () => api.getOrgTeams(owner),
    (error: unknown) => {
      assert(error instanceof GithubResponseStatusError);
      assertEquals(error.endpoint, teamsUrl);
      assertEquals(error.status, 500);
      assertEquals(error.response, payload);
      assert(error.message.includes(teamsUrl));
      assert(error.message.includes(JSON.stringify(payload)));
      return true;
    },
  );
});

function closedPullRequestIssue() {
  return {
    user: { id: 1, login: "octocat" },
    title: "Test PR",
    number: issueNumber,
    state: "closed",
    body: null,
    created_at: "2026-01-28T03:56:07Z",
    updated_at: "2026-01-29T06:56:29Z",
    closed_at: "2026-01-29T06:56:27Z",
    pull_request: {
      url: pullUrl,
    },
  };
}
