import { cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it } from "vitest";
import { createColumns as createPullColumns, type PullEntry } from "../user-stats/columns";
import { createColumns as createReviewColumns } from "../user-issue-reviews/columns";
import type { ReviewEntry } from "../../../../shared/models/userReviewStats";
import { DataTable } from "./data-table";

afterEach(cleanup);

const createdAt = "2025-01-01T00:00:00Z";
const pull = (issueId: number, overrides: Partial<PullEntry>): PullEntry => ({
  issueId,
  title: `Pull ${issueId}`,
  status: "merged",
  createdAt,
  ...overrides,
});

const pulls = [
  pull(1, {
    authorComments: 2,
    firstReviewTime: "2025-01-01T01:00:00Z",
    firstApprovalTime: "2025-01-01T08:00:00Z",
    closedAt: "2025-01-01T02:00:00Z",
  }),
  pull(2, {
    authorComments: 9,
    firstReviewTime: "2025-01-01T05:00:00Z",
    firstApprovalTime: "2025-01-01T02:00:00Z",
    closedAt: "2025-01-01T06:00:00Z",
  }),
  pull(3, {
    authorComments: 5,
    firstReviewTime: "2025-01-01T03:00:00Z",
    firstApprovalTime: "2025-01-01T04:00:00Z",
    closedAt: "2025-01-01T09:00:00Z",
  }),
];

const rowIds = (container: HTMLElement) =>
  [...container.querySelectorAll("tbody tr")].map((row) =>
    Number(row.querySelector("td")?.textContent?.replace("#", "")),
  );

it.each([
  ["Comments", [2, 3, 1]],
  ["First HumanReview", [2, 3, 1]],
  ["ApprovalTime", [1, 3, 2]],
  ["TimeOpen", [3, 2, 1]],
])("sorts pull rows by derived %s values", (header, expectedIds) => {
  const { container, getByRole } = render(
    <MemoryRouter>
      <DataTable
        columns={createPullColumns({ repoOwner: "example", repoName: "repo" })}
        data={pulls}
      />
    </MemoryRouter>,
  );
  fireEvent.click(getByRole("button", { name: header }));
  expect(rowIds(container)).toEqual(expectedIds);
});

const review = (issueId: number, authorComments: number): ReviewEntry => ({
  issueId,
  title: `Review ${issueId}`,
  authorLogin: `reviewer${issueId}`,
  createdAt,
  status: "Merged",
  reviewStatus: "Approved",
  wasFirstReviewer: false,
  timeToFirstReview: 2,
  authorComments,
  reviewerComments: 0,
  otherUserComments: 0,
  botComments: 0,
});

it("sorts review rows by their derived comment totals", () => {
  const { container, getByRole } = render(
    <MemoryRouter>
      <DataTable
        columns={createReviewColumns({ repoOwner: "example", repoName: "repo" })}
        data={[review(1, 2), review(2, 9), review(3, 5)]}
      />
    </MemoryRouter>,
  );
  fireEvent.click(getByRole("button", { name: "Comments" }));
  expect(rowIds(container)).toEqual([2, 3, 1]);
});
