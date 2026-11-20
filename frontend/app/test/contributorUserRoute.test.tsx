import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock:
    vi.fn<(url: string, token: string, options?: unknown) => Promise<Response>>(),
}));

vi.mock("../config", () => ({
  API_URL: "http://backend.test",
  authenticatedFetch: authenticatedFetchMock,
}));

vi.mock("../utils/session.server", () => ({
  requireUserSession: vi.fn(async () => ({ token: "test-token" })),
  getRepositoryIdFromCookie: vi.fn(() => 1),
}));

vi.mock("../components/ui/button", () => ({
  Button: ({ children, ...props }: ComponentPropsWithoutRef<"button">) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock("../components/ui/data-table", () => ({
  DataTable: ({ data }: { data: unknown[] }) => <div data-testid="data-table">{data.length}</div>,
}));

vi.mock("../components/user-stats/columns", () => ({
  createColumns: () => [],
}));

vi.mock("../components/user-issue-reviews/columns", () => ({
  createColumns: () => [],
}));

vi.mock("../components/user-stats/UserMonthlyMetricsChart", () => ({
  UserMonthlyMetricsChart: () => <div data-testid="monthly-metrics-chart" />,
}));

vi.mock("lucide-react", () => ({
  ArrowLeft: () => <span aria-hidden="true">left</span>,
}));

import {
  ContributorDetailsRoute as UserDetailsRoute,
  ContributorDetailErrorBoundary,
  loadContributorDetailData,
} from "../pages/contributorDetails";

async function loader({ params, request }: { params: { userName?: string }; request: Request }) {
  return loadContributorDetailData(request, "test-token", "1", params.userName ?? "unknown");
}

function TestUserDetailsRoute() {
  return <UserDetailsRoute backPath="/app/r/testRepo/explore/contributors" />;
}

function TestErrorBoundary() {
  return <ContributorDetailErrorBoundary backPath="/app/r/testRepo/explore/contributors" />;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  authenticatedFetchMock.mockImplementation(async (url) => {
    throw new Error(`Unhandled fetch: ${url}`);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderContributorRoute(userName: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/app/explore/contributors/:userName",
        loader,
        Component: TestUserDetailsRoute,
        ErrorBoundary: TestErrorBoundary,
      },
    ],
    {
      initialEntries: [`/app/explore/contributors/${userName}`],
    },
  );

  return render(<RouterProvider router={router} />);
}

function createInactiveUserStats() {
  return {
    issue_count: 0,
    pull_request_count: 0,
    merged_pull_count: 0,
    open_pull_count: 0,
    repo_owner: "acme",
    repo_name: "widgets",
    first_seen_timestamp: null,
    last_seen_timestamp: null,
    user_position: 0,
    total_unique_users: 0,
  };
}

describe("Contributor route", () => {
  it("renders the no activity state for a valid GitHub user with no repository activity", async () => {
    authenticatedFetchMock.mockImplementation(async (url) => {
      if (url.endsWith("/api/github/users/quiet-user")) {
        return jsonResponse({
          login: "quiet-user",
          name: "Quiet User",
          avatar_url: "https://example.com/avatar.png",
          company: null,
          location: null,
          created_at: "2024-01-15T00:00:00.000Z",
          html_url: "https://github.com/quiet-user",
        });
      }

      if (url.endsWith("/api/repository/1/users/quiet-user")) {
        return jsonResponse(createInactiveUserStats());
      }

      throw new Error(`Unexpected URL ${url}`);
    });

    renderContributorRoute("quiet-user");

    expect(await screen.findByText("Quiet User")).toBeTruthy();
    expect(screen.getByText("No Repository Activity")).toBeTruthy();
    expect(screen.queryByText("Pull Request Activity")).toBeNull();
    expect(screen.queryByText("User Stats")).toBeNull();
    expect(authenticatedFetchMock).toHaveBeenCalledTimes(2);
  });

  it("renders the route 404 boundary for an invalid GitHub username", async () => {
    authenticatedFetchMock.mockImplementation(async (url) => {
      if (url.endsWith("/api/github/users/missing-user")) {
        return jsonResponse({ error: "GitHub user not found" }, 404);
      }

      if (url.endsWith("/api/repository/1/users/missing-user")) {
        return jsonResponse(createInactiveUserStats());
      }

      throw new Error(`Unexpected URL ${url}`);
    });

    renderContributorRoute("missing-user");

    expect(await screen.findByText("404")).toBeTruthy();
    expect(screen.getByText("GitHub user not found")).toBeTruthy();
    expect(
      screen.getByText(
        "This contributor page doesn't exist because the GitHub username couldn't be found.",
      ),
    ).toBeTruthy();

    await waitFor(() => {
      expect(screen.queryByText("No Repository Activity")).toBeNull();
    });
  });
});
