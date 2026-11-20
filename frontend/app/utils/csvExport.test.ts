import { describe, expect, it } from "vitest";
import {
  buildCsv,
  buildReportCsvFilename,
  escapeCsvCell,
  sanitizeFilenameSegment,
} from "./csvExport";
import { AUTHOR_CSV_COLUMNS, REVIEWER_CSV_COLUMNS } from "./reportCsvColumns";
import type { AuthorStats } from "../../../shared/models/authorStats";
import type { ReviewerStats } from "../../../shared/models/reviewerStats";

const metric = (value: number | null) => ({
  value,
  category: "average" as const,
});

describe("escapeCsvCell", () => {
  it("returns empty string for null and undefined", () => {
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
  });

  it("leaves plain values untouched", () => {
    expect(escapeCsvCell("alice")).toBe("alice");
    expect(escapeCsvCell(1.25)).toBe("1.25");
    expect(escapeCsvCell(0)).toBe("0");
  });

  it("quotes values containing commas, quotes, or line breaks", () => {
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("buildCsv", () => {
  it("emits a header row and one line per row with CRLF endings", () => {
    const csv = buildCsv(
      [
        {
          header: "Name",
          value: (row: { name: string; n: number | null }) => row.name,
        },
        { header: "N", value: (row) => row.n },
      ],
      [
        { name: "alice", n: 3 },
        { name: "bob, jr", n: null },
      ],
    );
    expect(csv).toBe('Name,N\r\nalice,3\r\n"bob, jr",\r\n');
  });
});

describe("sanitizeFilenameSegment", () => {
  it("replaces slashes and unsafe characters", () => {
    expect(sanitizeFilenameSegment("acme-org/web app")).toBe("acme-org-web-app");
    expect(sanitizeFilenameSegment("  ../weird//name  ")).toBe("weird-name");
  });
});

describe("buildReportCsvFilename", () => {
  it("leads with the report type and uses ISO dates", () => {
    expect(
      buildReportCsvFilename({
        report: "author_reports",
        repoRef: "acme/widgets",
        from: "2026-09-16",
        to: "2026-09-23",
      }),
    ).toBe("author_reports_acme-widgets_2026-09-16_to_2026-09-23.csv");
  });

  it("omits the repo segment when no repo ref is available", () => {
    expect(
      buildReportCsvFilename({
        report: "reviewer_reports",
        from: "2026-01-01",
        to: "2026-01-31",
      }),
    ).toBe("reviewer_reports_2026-01-01_to_2026-01-31.csv");
  });
});

describe("report CSV columns", () => {
  it("exports raw author values, with hours as decimals and blanks for null", () => {
    const row: AuthorStats = {
      author: "alice",
      active_days: metric(14),
      open_prs_count: metric(20),
      merged_prs_count: metric(79),
      avg_pr_per_active_day: metric(5.64),
      avg_time_to_merge: metric(30.5),
      median_time_to_merge: metric(24),
      avg_time_to_first_review: metric(1.3),
      median_time_to_first_review: metric(null),
      avg_rounds_of_review: metric(0.06),
      total_comments_merged: metric(12),
      avg_comments_per_pr: metric(0.15),
      median_comments_per_pr: metric(0),
      median_files_changed: metric(3),
      avg_files_changed: metric(4.2),
      median_lines_changed: metric(50),
      avg_lines_changed: metric(88.4),
      total_additions: metric(1000),
      total_deletions: metric(250),
      unique_files_touched_count: metric(42),
      top_touched_package: "backend, api",
    };
    const csv = buildCsv(AUTHOR_CSV_COLUMNS, [row]);
    const [header, line] = csv.trimEnd().split("\r\n");
    expect(header).toContain("Avg Time to First Review (hours)");
    const cells = line.split(",");
    const headers = header.split(",");
    const cell = (name: string) => cells[headers.indexOf(name)];
    expect(cell("Avg Time to First Review (hours)")).toBe("1.3");
    expect(cell("Median Time to First Review (hours)")).toBe("");
    expect(cell("Total Lines Changed")).toBe("1250");
    expect(line.endsWith('"backend, api"')).toBe(true);
  });

  it("exports reviewer values in column order", () => {
    const row: ReviewerStats = {
      reviewer: "bob",
      active_days: metric(10),
      review_count: metric(30),
      first_review_count: metric(8),
      approval_count: metric(25),
      total_non_author_comments: metric(60),
      median_time_as_first_reviewer: metric(2.5),
      avg_time_as_first_reviewer: metric(3.75),
      unique_authors_interacted_with: metric(9),
      most_interacted_author: "alice",
      most_interacted_author_by_comments: "carol",
      total_lines_reviewed: metric(5000),
      median_lines_per_reviewed_pr: metric(120),
      avg_comments_per_reviewed_pr: metric(2),
    };
    const csv = buildCsv(REVIEWER_CSV_COLUMNS, [row]);
    expect(csv.split("\r\n")[1]).toBe("bob,30,10,25,8,3.75,2.5,2,60,120,5000,9,alice,carol");
  });
});
