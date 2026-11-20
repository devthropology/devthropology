import { beforeEach, describe, expect, it, vi } from "vitest";

const { authenticatedFetchMock, requireUserSessionMock, fetchRepositoriesMock } = vi.hoisted(
  () => ({
    authenticatedFetchMock: vi.fn(),
    requireUserSessionMock: vi.fn(),
    fetchRepositoriesMock: vi.fn(),
  }),
);

vi.mock("../config", () => ({
  API_URL: "http://backend.test",
  authenticatedFetch: authenticatedFetchMock,
}));
vi.mock("../utils/session.server", () => ({
  requireUserSession: requireUserSessionMock,
  getRepositoryIdFromCookie: () => null,
}));
vi.mock("../utils/repositoryRequests", () => ({
  fetchRepositoriesWithRetry: fetchRepositoriesMock,
}));

import { loader as settingsLoader } from "../routes/app.settings";
import { loader as indexLoader } from "../routes/app._index";

const user = { userId: "user-1", username: "alice", role: "user", token: "private-token" };
const settingsArgs = {
  request: new Request("http://example.com/app/settings"),
  url: new URL("http://example.com/app/settings"),
} as Parameters<typeof settingsLoader>[0];
const indexArgs = {
  request: new Request("http://example.com/app"),
  url: new URL("http://example.com/app"),
} as Parameters<typeof indexLoader>[0];

beforeEach(() => {
  vi.clearAllMocks();
  requireUserSessionMock.mockResolvedValue(user);
  fetchRepositoriesMock.mockResolvedValue([]);
  // Each request needs a fresh body, including the GitHub connection requests.
  authenticatedFetchMock.mockImplementation(() => Promise.resolve(Response.json([])));
});

describe("repository-independent settings", () => {
  it("allows an ordinary account with no workspaces and omits its token from page data", async () => {
    const result = await settingsLoader(settingsArgs);
    expect(result).toMatchObject({
      user: { username: "alice", role: "user" },
      workspaces: [],
      workspacesError: false,
    });
    expect(authenticatedFetchMock).toHaveBeenCalledWith(
      "http://backend.test/api/workspaces?includeRepositories=1",
      user.token,
      { request: settingsArgs.request },
    );
  });

  it("loads accessible workspaces", async () => {
    const workspace = {
      workspaceId: "ws-1",
      name: "Personal",
      workspaceType: "user",
      repositoryIds: ["repo-a"],
    };
    authenticatedFetchMock.mockImplementation((url: string) =>
      Promise.resolve(Response.json(url.includes("/api/workspaces?") ? [workspace] : [])),
    );
    expect((await settingsLoader(settingsArgs)).workspaces).toEqual([workspace]);
  });

  it("distinguishes request failures from an empty workspace list", async () => {
    authenticatedFetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    expect((await settingsLoader(settingsArgs)).workspacesError).toBe(true);
  });

  it("preserves the unauthenticated login redirect", async () => {
    const redirect = new Response(null, { status: 302, headers: { Location: "/login" } });
    requireUserSessionMock.mockRejectedValue(redirect);
    await expect(settingsLoader(settingsArgs)).rejects.toBe(redirect);
    expect(authenticatedFetchMock).not.toHaveBeenCalled();
  });
});

describe("app entry navigation", () => {
  it("redirects an empty account to settings", async () => {
    const result = await indexLoader(indexArgs).catch((response: Response) => response);
    if (!(result instanceof Response)) throw new Error("Expected a redirect response");
    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toBe("/app/settings");
  });

  it("retains the repository dashboard redirect", async () => {
    fetchRepositoriesMock.mockResolvedValue([{ id: "repo-1", org: "acme", name: "widgets" }]);
    const result = await indexLoader(indexArgs).catch((response: Response) => response);
    if (!(result instanceof Response)) throw new Error("Expected a redirect response");
    expect(result.headers.get("Location")).toBe("/app/r/repo-1");
  });

  it("does not treat a repository request failure as an empty account", async () => {
    const error = new Error("Backend unavailable");
    fetchRepositoriesMock.mockRejectedValue(error);
    await expect(indexLoader(indexArgs)).rejects.toBe(error);
  });
});
