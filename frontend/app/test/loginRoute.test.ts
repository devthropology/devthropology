import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

afterEach(cleanup);

const { apiFetchMock, createUserSessionMock, fetchRepositoriesWithRetryMock, getUserSessionMock } =
  vi.hoisted(() => ({
    apiFetchMock: vi.fn(),
    createUserSessionMock: vi.fn(),
    fetchRepositoriesWithRetryMock: vi.fn(),
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
  getUserSession: getUserSessionMock,
  sanitizeRedirectTarget: (candidate: string | null | undefined) => {
    if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) {
      return "/app";
    }

    if (candidate !== "/app" && !candidate.startsWith("/app/")) {
      return "/app";
    }

    return candidate;
  },
}));

import Login, { action, loader } from "../routes/login";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("login route", () => {
  it.each(["__proto__", "constructor", "toString", "unknown"])(
    "renders a safe fallback for githubError=%s",
    async (code) => {
      const router = createMemoryRouter(
        [{ path: "/login", element: createElement(Login), loader: () => null }],
        { initialEntries: [`/login?githubError=${encodeURIComponent(code)}`] },
      );
      render(createElement(RouterProvider, { router }));
      expect((await screen.findByRole("alert")).textContent).toContain("temporarily unavailable");
      router.dispose();
    },
  );

  beforeEach(() => {
    vi.clearAllMocks();
    getUserSessionMock.mockResolvedValue(null);
    createUserSessionMock.mockResolvedValue(new Response(null, { status: 302 }));
    fetchRepositoriesWithRetryMock.mockResolvedValue([]);
  });

  it("redirects authenticated users to their requested destination", async () => {
    getUserSessionMock.mockResolvedValue({ userId: "1" });

    const response = (await loader({
      request: new Request("http://example.com/login?redirectTo=%2Fapp%2Fr%2Fdemo"),
    } as Parameters<typeof loader>[0])) as Response;

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/app/r/demo");
  });

  it("sends the preserved redirect target into session creation after login", async () => {
    const sessionResponse = new Response(null, {
      status: 302,
      headers: { Location: "/app/r/demo/explore/contributors/alice?tab=activity" },
    });
    createUserSessionMock.mockResolvedValue(sessionResponse);
    apiFetchMock.mockResolvedValue(
      jsonResponse({
        userId: "1",
        username: "demo-user",
        role: "admin",
        token: "token-123",
      }),
    );
    fetchRepositoriesWithRetryMock.mockResolvedValue([
      { id: "repo-1", org: "acme", name: "widgets" },
    ]);

    const response = (await action({
      request: new Request("http://example.com/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: new URLSearchParams({
          username: "demo-user",
          password: "secret",
          redirectTo: "/app/r/demo/explore/contributors/alice?tab=activity",
        }),
      }),
    } as Parameters<typeof action>[0])) as Response;

    expect(createUserSessionMock).toHaveBeenCalledWith(
      "1",
      "demo-user",
      "admin",
      "token-123",
      "/app/r/demo/explore/contributors/alice?tab=activity",
      expect.stringContaining("selectedRepositoryId=repo-1"),
    );
    expect(response).toBe(sessionResponse);
  });
});
