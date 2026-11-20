import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportUserFilter } from "./ReportUserFilter";
import { ReportTiersToggle } from "./ReportTiersToggle";

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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function FilterHarness({ label }: { label: "authors" | "reviewers" }) {
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  return (
    <ReportUserFilter
      label={label}
      users={["alice", "bob"]}
      selectedUsers={selectedUsers}
      onToggle={(user) =>
        setSelectedUsers((current) =>
          current.includes(user) ? current.filter((name) => name !== user) : [...current, user],
        )
      }
      onClear={() => setSelectedUsers([])}
    />
  );
}

describe("shared report controls", () => {
  it.each(["authors", "reviewers"] as const)(
    "supports search, selection and clear for %s",
    async (label) => {
      render(<FilterHarness label={label} />);
      fireEvent.click(screen.getByRole("button", { name: `Filter ${label}` }));
      const dialog = screen.getByRole("dialog");
      const search = within(dialog).getByRole("combobox", { name: `Search ${label}` });
      fireEvent.change(search, { target: { value: "bob" } });
      await waitFor(() =>
        expect(within(dialog).queryByRole("option", { name: "alice" })).toBeNull(),
      );
      fireEvent.click(within(dialog).getByRole("option", { name: "bob" }));
      expect(within(dialog).getByText("1 selected")).toBeTruthy();
      fireEvent.click(within(dialog).getByRole("button", { name: "Clear all" }));
      expect(within(dialog).getByText("0 selected")).toBeTruthy();
    },
  );

  it("does not allow opening a user filter disabled by a team selection", () => {
    const onToggle = vi.fn();
    render(
      <ReportUserFilter
        label="authors"
        users={["alice"]}
        selectedUsers={[]}
        onToggle={onToggle}
        onClear={() => {}}
        disabled
      />,
    );
    const button = screen.getByRole("button", { name: "Filter authors" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("keeps tiers controlled by the page and disables them while benchmarks load", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ReportTiersToggle checked={false} onChange={onChange} description="Combined population" />,
    );
    fireEvent.click(screen.getByRole("switch", { name: "Show Tiers" }));
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(
      <ReportTiersToggle checked onChange={onChange} description="Combined population" loading />,
    );
    const toggle = screen.getByRole("switch", { name: "Show Tiers" }) as HTMLButtonElement;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.disabled).toBe(true);
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
