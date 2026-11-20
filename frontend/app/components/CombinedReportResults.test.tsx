import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorStatsSchema } from "../../../shared/models/authorStats";
import { ReviewerStatsSchema } from "../../../shared/models/reviewerStats";
import { CombinedReportResults, type CombinedReportResult } from "./CombinedReportResults";
import { downloadCsv } from "../utils/csvExport";

vi.mock("../utils/csvExport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/csvExport")>()),
  downloadCsv: vi.fn(),
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
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const metric = { value: 3, category: "high" };
const author = (name: string) =>
  AuthorStatsSchema.parse({
    ...Object.fromEntries(Object.keys(AuthorStatsSchema.shape).map((key) => [key, metric])),
    author: name,
    top_touched_package: "acme/frontend:src",
  });
const reviewer = (name: string) =>
  ReviewerStatsSchema.parse({
    ...Object.fromEntries(Object.keys(ReviewerStatsSchema.shape).map((key) => [key, metric])),
    reviewer: name,
    most_interacted_author: "alice",
    most_interacted_author_by_comments: "alice",
  });

for (const report of ["authors", "reviewers"] as const) {
  describe(`combined ${report} results`, () => {
    const selection = {
      workspaceId: "w1",
      repositoryIds: ["6khJ", "LgYX"],
      report,
      startDate: "2026-01-01",
      endDate: "2026-02-01",
    };
    const result: CombinedReportResult =
      report === "authors"
        ? {
            report,
            data: { authors: [author("alice"), author("bob")], thresholds: [author("Top")] },
          }
        : {
            report,
            data: {
              reviewers: [reviewer("alice"), reviewer("bob")],
              thresholds: [reviewer("Top")],
            },
          };

    it("filters locally, preserves ratings, and exports only selected people (not tiers)", () => {
      render(<CombinedReportResults result={result} selection={selection} />);
      expect(screen.getByText("2 of 2 people")).toBeTruthy();
      expect(screen.queryAllByRole("link")).toHaveLength(0);
      fireEvent.click(screen.getByRole("button", { name: `Filter ${report}` }));
      const dialog = screen.getByRole("dialog");
      fireEvent.click(within(dialog).getByRole("option", { name: "bob" }));
      expect(screen.getByText("1 of 2 people")).toBeTruthy();
      fireEvent.click(screen.getByRole("switch", { name: "Show Tiers" }));
      expect(screen.getByText("Top")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
      const [filename, csv] = vi.mocked(downloadCsv).mock.calls[0];
      expect(filename).toContain(`combined_${report}_6khJ-LgYX`);
      const lines = csv.trim().split("\r\n");
      expect(lines).toHaveLength(2);
      expect(lines[1]).toMatch(/^bob,/);
      expect(lines[1]).toMatch(/^bob,3,3,/);
      const people = result.report === "authors" ? result.data.authors : result.data.reviewers;
      expect(people[1].active_days).toEqual(metric);
      expect(lines[1]).not.toContain("Top");
      // The input response remains the full cohort with unchanged ratings.
      expect(people).toHaveLength(2);
    });

    it("shows a genuine empty state and disables export", () => {
      const empty: CombinedReportResult =
        report === "authors"
          ? { report, data: { authors: [], thresholds: [] } }
          : { report, data: { reviewers: [], thresholds: [] } };
      render(<CombinedReportResults result={empty} selection={selection} />);
      expect(screen.getByRole("status").textContent).toContain("activity");
      expect(
        (screen.getByRole("button", { name: "Export CSV" }) as HTMLButtonElement).disabled,
      ).toBe(true);
    });
  });
}
