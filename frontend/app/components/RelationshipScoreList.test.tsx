import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RelationshipScoreList } from "./RelationshipScoreList";

vi.mock("react-router", () => ({
  useLocation: () => ({ pathname: "/app/r/repo-1/relationships" }),
  Link: ({ to, children, onClick, ...props }: ComponentPropsWithoutRef<"a"> & { to: string }) => (
    <a
      href={to}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
      {...props}
    >
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
});

const rows = [
  {
    fromUserId: 1,
    toUserId: 2,
    weight: 1221,
    edgeData: {
      v: 1,
      prs_touched: 475,
      total_events: 0,
      approvals: 444,
      changes_requested: 9,
      reviews_with_body: 200,
      inline_comments: 300,
      convo_comments: 207,
      dismissed: 0,
    },
  },
];

describe("RelationshipScoreList", () => {
  it("expands a row to show formatted relationship metrics", () => {
    render(
      <RelationshipScoreList
        title="Gives feedback to"
        rows={rows}
        getLogin={(edge) => (edge.toUserId === 2 ? "mndubuisi" : "unknown")}
      />,
    );

    const row = screen.getByText("mndubuisi").closest('[role="button"]');
    if (!row) throw new Error("Expected relationship row");

    expect(row.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(row);

    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("475")).toBeTruthy();
    expect(screen.getByText("444")).toBeTruthy();
    expect(screen.getByText("707")).toBeTruthy();
    expect(screen.getByText("9")).toBeTruthy();
    expect(screen.getByText("1,221")).toBeTruthy();
  });

  it("does not toggle the row when the contributor link is clicked", () => {
    render(
      <RelationshipScoreList title="Gives feedback to" rows={rows} getLogin={() => "mndubuisi"} />,
    );

    const row = screen.getByText("mndubuisi").closest('[role="button"]');
    if (!row) throw new Error("Expected relationship row");

    fireEvent.click(screen.getByRole("link", { name: "mndubuisi" }));

    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("707")).toBeNull();
  });
});
