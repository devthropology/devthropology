import { expect, test, vi } from "vitest";
import { GhApi } from "../api/ghApi.ts";
import { Backfiller } from "./backfiller.ts";
import type { HydratedIssue } from "../models/gh/issue.ts";
import { IssueType } from "../models/gh/issueType.ts";
import { State } from "../models/gh/state.ts";
import type { IRepository } from "../repository/repository.ts";
import { GithubArchiveError } from "../features/githubArchive/githubArchiveTypes.ts";
import { RateExceededError } from "../models/errors/RateExceededError.ts";

function setup(type = IssueType.PULL_REQUEST, state = State.CLOSED) {
  const issue: HydratedIssue = {
    number: 42,
    type,
    state,
    title: "test",
    body: "body",
    user: { id: 1, login: "author" },
    created_at: new Date(),
    updated_at: new Date(),
    closed_at: state === State.CLOSED ? new Date() : null,
  };
  const api = new GhApi("org", "repo", "user", "unused");
  vi.spyOn(api, "getRateLimit").mockResolvedValue({
    rate: { limit: 5000, used: 0, remaining: 5000, reset: 0 },
  });
  vi.spyOn(api, "getMostRecentIssue").mockResolvedValue(42);
  vi.spyOn(api, "getPullRequestNumbersByUser").mockResolvedValue([42]);
  vi.spyOn(api, "getFullIssue").mockResolvedValue(issue);
  const responses = [
    {
      endpoint: "https://api.github.com/repos/org/repo/issues/42",
      status: 200,
      response: { extra: "raw field" },
    },
  ];
  vi.spyOn(api, "getEndpointResponses").mockReturnValue({
    42: responses,
    41: [{ endpoint: "previous", status: 200, response: {} }],
  });
  const repo = {
    insertIssue: vi.fn().mockResolvedValue(undefined),
    getClosedIssues: vi.fn().mockResolvedValue([]),
    getOpenNonPullRequestIssues: vi.fn().mockResolvedValue([]),
    getLowestIssueId: vi.fn().mockResolvedValue(43),
    updateUserActivity: vi.fn().mockResolvedValue(undefined),
    getAllProcessedPullRequests: vi.fn().mockResolvedValue([]),
    getOpenPullRequestsToSkip: vi.fn().mockResolvedValue([]),
  };
  const archive = {
    save: vi.fn().mockResolvedValue(undefined),
    uploadPending: vi.fn().mockResolvedValue(0),
  };
  const backfiller = new Backfiller(api, repo as unknown as IRepository, {
    archive,
    silent: true,
  });
  return { backfiller, repo, api, archive, responses };
}

test.each([
  [IssueType.PULL_REQUEST, State.CLOSED, true],
  [IssueType.PULL_REQUEST, State.OPEN, false],
  [IssueType.ISSUE, State.OPEN, true],
  [IssueType.ISSUE, State.CLOSED, true],
  [IssueType.NOT_FOUND, State.CLOSED, false],
  [IssueType.DELETED, State.CLOSED, false],
  [IssueType.MOVED, State.CLOSED, false],
])(
  "archive eligibility: type=%s state=%s included=%s",
  async (type, state, included) => {
    const f = setup(type, state);
    f.archive.save.mockImplementation(async () => {
      expect(f.repo.insertIssue).toHaveBeenCalledTimes(1);
    });
    await f.backfiller.backfillFromLatest(1);
    expect(f.archive.save).toHaveBeenCalledTimes(included ? 1 : 0);
    if (included)
      expect(f.archive.save).toHaveBeenCalledWith(
        expect.objectContaining({ number: 42, responses: f.responses }),
      );
  },
);

test("failed DB writes never enter the archive", async () => {
  const f = setup();
  f.repo.insertIssue.mockRejectedValue(new Error("transaction rolled back"));
  await f.backfiller.backfillFromLatest(1);
  expect(f.archive.save).not.toHaveBeenCalled();
});

const entryPoints = [
  (b: Backfiller) => b.backfillFromLatest(1),
  (b: Backfiller) => b.backfillFromLastProcessed(1),
  (b: Backfiller) => b.forUsers("author"),
];

test("uploads finalized captures even after a disk-write failure", async () => {
  const run = (b: Backfiller) => b.backfillFromLatest(1);
  const f = setup();
  const failure = new GithubArchiveError("disk full");
  f.archive.save.mockRejectedValue(failure);
  await expect(run(f.backfiller)).rejects.toBe(failure);
  expect(f.archive.uploadPending).toHaveBeenCalledTimes(1);
  expect(f.repo.insertIssue).toHaveBeenCalledTimes(1);
});

test.each(entryPoints)("uploads once after all sync work: %#", async (run) => {
  const f = setup();
  const events: string[] = [];
  f.repo.insertIssue.mockImplementation(async () => {
    events.push("insert");
  });
  f.archive.save.mockImplementation(async () => {
    events.push("save");
  });
  f.repo.updateUserActivity.mockImplementation(async () => {
    events.push("postprocess");
  });
  f.archive.uploadPending.mockImplementation(async () => {
    events.push("upload");
    return 1;
  });
  await run(f.backfiller);
  expect(events.slice(0, 2)).toEqual(["insert", "save"]);
  expect(events.at(-1)).toBe("upload");
  expect(f.archive.uploadPending).toHaveBeenCalledTimes(1);
});

test("preserves original sync error if final upload also fails", async () => {
  const run = (b: Backfiller) => b.backfillFromLatest(1);
  const f = setup();
  const original = new Error("sync failure");
  vi.mocked(f.api.getRateLimit).mockRejectedValue(original);
  f.archive.uploadPending.mockRejectedValue(
    new GithubArchiveError("R2 unavailable"),
  );
  await expect(run(f.backfiller)).rejects.toBe(original);
  expect(f.archive.uploadPending).toHaveBeenCalledTimes(1);
});

test("rate-limit early exit still uploads pending captures and preserves progress", async () => {
  const f = setup();
  vi.mocked(f.api.getFullIssue).mockRejectedValue(new RateExceededError("0"));
  const progress =
    await f.backfiller.backfillFromLatestPullRequestsWithResult(1);
  expect(progress.hitRateLimit).toBe(true);
  expect(progress.nextStartIssueNumber).toBe(42);
  expect(f.archive.uploadPending).toHaveBeenCalledTimes(1);
});
