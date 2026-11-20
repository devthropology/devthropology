import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Calendar } from "./calendar";

afterEach(cleanup);

describe("Calendar", () => {
  it("renders custom navigation and selects a date with Day Picker 9", () => {
    const onSelect = vi.fn();
    render(<Calendar mode="single" defaultMonth={new Date(2026, 0, 1)} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: /next month/i }));
    expect(screen.getByRole("grid").getAttribute("aria-label")).toBe("February 2026");
    fireEvent.click(screen.getByRole("button", { name: /February 12th, 2026/i }));
    expect(onSelect.mock.calls[0][0]).toEqual(new Date(2026, 1, 12));
    fireEvent.click(screen.getByRole("button", { name: /previous month/i }));
    expect(screen.getByRole("grid").getAttribute("aria-label")).toBe("January 2026");
  });

  it("retains range highlighting on the new day cells", () => {
    render(
      <Calendar
        mode="range"
        defaultMonth={new Date(2026, 0, 1)}
        selected={{ from: new Date(2026, 0, 12), to: new Date(2026, 0, 15) }}
      />,
    );
    const start = screen.getByRole("button", { name: /January 12th, 2026/i }).closest("td");
    const end = screen.getByRole("button", { name: /January 15th, 2026/i }).closest("td");
    expect(start?.className).toContain("day-range-start");
    expect(end?.className).toContain("day-range-end");
    expect(start?.getAttribute("aria-selected")).toBe("true");
    expect(end?.getAttribute("aria-selected")).toBe("true");
  });
});
