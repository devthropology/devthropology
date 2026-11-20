import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AuthorStatsSchema } from "../../../shared/models/authorStats";
import { ReviewerStatsSchema } from "../../../shared/models/reviewerStats";
import { TeamSchema } from "../../../shared/models/team";
import { AuthorReportsPage } from "../pages/reportsAuthors";
import { ReviewerReportsPage } from "../pages/reportsReviewers";

// Focus these regression tests on page-owned URL/team behavior, not calendar rendering.
vi.mock("../components/ui/EnhancedDateRangePicker", () => ({
  EnhancedDateRangePicker: () => <div>Date range</div>,
}));

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const metric = { value: 3, category: "high" };
const authorData = {
  authors: [
    AuthorStatsSchema.parse({
      ...Object.fromEntries(Object.keys(AuthorStatsSchema.shape).map((key) => [key, metric])),
      author: "alice",
      top_touched_package: "src",
    }),
  ],
  thresholds: [],
};
const reviewerData = {
  reviewers: [
    ReviewerStatsSchema.parse({
      ...Object.fromEntries(Object.keys(ReviewerStatsSchema.shape).map((key) => [key, metric])),
      reviewer: "alice",
      most_interacted_author: "bob",
      most_interacted_author_by_comments: "bob",
    }),
  ],
  thresholds: [],
};
const shared = {
  repositoryId: "6khJ",
  users: ["alice"],
  selectedTeamMembers: ["alice"],
  teams: [
    TeamSchema.parse({
      teamId: 1,
      repositoryId: 1,
      name: "Core",
      slug: "core",
      sourceType: "manual",
      ghTeamId: null,
      ghOrgLogin: null,
      memberCount: 1,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    }),
  ],
};

for (const report of ["authors", "reviewers"] as const) {
  it(`single-repo ${report}: shared controls retain URL filtering and team mutual exclusion`, async () => {
    const path = `/app/r/6khJ/reports/${report}`;
    const authorLoaderData = {
      ...shared,
      stats: Promise.resolve(authorData),
      orgData: Promise.resolve(authorData),
    };
    const reviewerLoaderData = {
      ...shared,
      stats: Promise.resolve(reviewerData),
      orgThresholds: Promise.resolve(reviewerData),
    };
    const buildPath = (search: string) => `${path}?${search}`;
    const router = createMemoryRouter(
      [
        {
          path,
          Component: () =>
            report === "authors" ? (
              <AuthorReportsPage
                loaderData={authorLoaderData}
                buildPath={buildPath}
                repoRef="6khJ"
              />
            ) : (
              <ReviewerReportsPage
                loaderData={reviewerLoaderData}
                buildPath={buildPath}
                repoRef="6khJ"
              />
            ),
        },
      ],
      {
        initialEntries: [`${path}?startDate=2026-01-01&endDate=2026-02-01`],
      },
    );
    render(<RouterProvider router={router} />);
    fireEvent.click(await screen.findByRole("button", { name: `Filter ${report}` }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("option", { name: "alice" }));
    expect(
      (screen.getByRole("button", { name: "Filter teams" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await waitFor(() => expect(router.state.location.search).toContain("users=alice"), {
      timeout: 2000,
    });
    // Router state updates before React commits its URL-to-draft sync effect.
    await act(async () => {});
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Clear all" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(router.state.location.search).not.toContain("users="), {
      timeout: 2000,
    });
    fireEvent.click(screen.getByRole("button", { name: "Filter teams" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("option", { name: /Core/ }));
    expect(
      (screen.getByRole("button", { name: `Filter ${report}` }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await waitFor(() => expect(router.state.location.search).toContain("teams=core"), {
      timeout: 2000,
    });
    const toggle = screen.getByRole("switch", { name: "Show Tiers" });
    await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    router.dispose();
  });
}
