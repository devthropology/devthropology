import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  apiFetchMock,
  createUserSessionMock,
  fetchRepositoriesWithRetryMock,
  getRepositoryIdFromCookieMock,
  getUserSessionMock,
} = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  createUserSessionMock: vi.fn(),
  fetchRepositoriesWithRetryMock: vi.fn(),
  getRepositoryIdFromCookieMock: vi.fn(),
  getUserSessionMock: vi.fn(),
}));

vi.mock("~/config", () => ({
  API_URL: "http://backend.test",
  apiFetch: apiFetchMock,
}));

vi.mock("~/utils/repositoryPreferences", () => ({
  REPO_ID_KEY: "selectedRepositoryId",
}));

vi.mock("~/utils/repositoryRequests", () => ({
  fetchRepositoriesWithRetry: fetchRepositoriesWithRetryMock,
}));

vi.mock("~/utils/session.server", () => ({
  createUserSession: createUserSessionMock,
  getRepositoryIdFromCookie: getRepositoryIdFromCookieMock,
  getUserSession: getUserSessionMock,
}));

import { loader } from "../routes/demo.v2";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("demo route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserSessionMock.mockResolvedValue(null);
    getRepositoryIdFromCookieMock.mockReturnValue(null);
    createUserSessionMock.mockResolvedValue(new Response(null, { status: 302 }));
    fetchRepositoriesWithRetryMock.mockResolvedValue([]);
  });

  it("redirects authenticated users to app", async () => {
    getUserSessionMock.mockResolvedValue({ userId: "1" });

    const response = (await loader({
      request: new Request("http://example.com/demo/v2"),
    } as Parameters<typeof loader>[0])) as Response;

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/app");
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("creates a normal user session from backend demo login", async () => {
    const sessionResponse = new Response(null, {
      status: 302,
      headers: { Location: "/app" },
    });
    createUserSessionMock.mockResolvedValue(sessionResponse);
    apiFetchMock.mockResolvedValue(
      jsonResponse({
        userId: "1",
        username: "demo-user",
        role: "user",
        token: "token-123",
      }),
    );
    fetchRepositoriesWithRetryMock.mockResolvedValue([
      { id: "repo-2", org: "zeta", name: "api" },
      { id: "repo-1", org: "acme", name: "widgets" },
    ]);

    const response = (await loader({
      request: new Request("http://example.com/demo/v2"),
    } as Parameters<typeof loader>[0])) as Response;

    expect(apiFetchMock).toHaveBeenCalledWith("http://backend.test/api/auth/demo-login", {
      method: "POST",
      request: expect.any(Request),
      retryCount: 2,
    });
    expect(createUserSessionMock).toHaveBeenCalledWith(
      "1",
      "demo-user",
      "user",
      "token-123",
      "/app",
      expect.stringContaining("selectedRepositoryId=repo-1"),
    );
    expect(response).toBe(sessionResponse);
  });

  it("defaults to getsentry/sentry when there is no saved repository", async () => {
    apiFetchMock.mockResolvedValue(
      jsonResponse({
        userId: "1",
        username: "demo-user",
        role: "user",
        token: "token-123",
      }),
    );
    fetchRepositoriesWithRetryMock.mockResolvedValue([
      { id: "calcom-public-id", org: "calcom", name: "cal.com" },
      { id: "sentry-public-id", org: "getsentry", name: "sentry" },
    ]);

    await loader({
      request: new Request("http://example.com/demo/v2"),
    } as Parameters<typeof loader>[0]);

    expect(createUserSessionMock).toHaveBeenCalledWith(
      "1",
      "demo-user",
      "user",
      "token-123",
      "/app",
      expect.stringContaining("selectedRepositoryId=sentry-public-id"),
    );
  });

  it("keeps a saved repository ahead of the demo default", async () => {
    getRepositoryIdFromCookieMock.mockReturnValue("calcom-public-id");
    apiFetchMock.mockResolvedValue(
      jsonResponse({
        userId: "1",
        username: "demo-user",
        role: "user",
        token: "token-123",
      }),
    );
    fetchRepositoriesWithRetryMock.mockResolvedValue([
      { id: "calcom-public-id", org: "calcom", name: "cal.com" },
      { id: "sentry-public-id", org: "getsentry", name: "sentry" },
    ]);

    await loader({
      request: new Request("http://example.com/demo/v2"),
    } as Parameters<typeof loader>[0]);

    expect(createUserSessionMock).toHaveBeenCalledWith(
      "1",
      "demo-user",
      "user",
      "token-123",
      "/app",
      expect.stringContaining("selectedRepositoryId=calcom-public-id"),
    );
  });
});
