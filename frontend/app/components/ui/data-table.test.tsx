import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { DataTableColumnDef as ColumnDef } from "./data-table-features";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataTable } from "./data-table";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("refreshes horizontal geometry when same-count replacement rows resize the table", () => {
  const observers: MockResizeObserver[] = [];
  class MockResizeObserver {
    targets = new Set<Element>();
    constructor(public callback: () => void) {
      observers.push(this);
    }
    observe(target: Element) {
      this.targets.add(target);
    }
    disconnect() {
      this.targets.clear();
    }
  }
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  // Geometry is simulated because jsdom does not perform table layout.
  let contentWidth = 400;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(() => contentWidth);

  const columns: ColumnDef<{ package: string }>[] = [{ accessorKey: "package", header: "Package" }];
  const view = (value: string) => (
    <DataTable columns={columns} data={[{ package: value }]} showCustomHorizontalScrollbar />
  );
  const { container, rerender } = render(view("short"));
  const table = container.querySelector("table")!;
  const thumb = () => container.querySelector<HTMLElement>(".will-change-transform");
  const notifyTableResize = () => {
    const watchingTable = observers.filter((observer) => observer.targets.has(table));
    expect(watchingTable.length).toBeGreaterThan(0);
    act(() => watchingTable.forEach((observer) => observer.callback()));
  };

  expect(thumb()).toBeNull();

  contentWidth = 800;
  rerender(view("a/much/longer/package/path"));
  notifyTableResize();
  // Simulate the initial notification for the newly mounted scrollbar track.
  notifyTableResize();
  expect(thumb()?.style.width).toBe("200px");

  contentWidth = 1200;
  rerender(view("an/even/longer/package/path/than/before"));
  notifyTableResize();
  expect(parseFloat(thumb()!.style.width)).toBeCloseTo(400 / 3);

  contentWidth = 400;
  rerender(view("short"));
  notifyTableResize();
  expect(thumb()).toBeNull();
});

type Contributor = { login: string };
const columns: ColumnDef<Contributor>[] = [
  {
    accessorKey: "login",
    header: ({ column }) => <button onClick={column.getToggleSortingHandler()}>Contributor</button>,
    size: 200,
  },
];
const data = Array.from({ length: 700 }, (_, index) => ({ login: `person-${index}` }));

function renderTable(props: { virtualizeRows?: boolean; pinnedRows?: Contributor[] }) {
  const container = document.createElement("div");
  container.innerHTML = renderToString(
    <DataTable columns={columns} data={data} pinnedColumn="login" {...props} />,
  );
  return container;
}

describe("DataTable client-side virtualization", () => {
  const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");

  beforeEach(() => {
    // JSDOM has no layout engine. Supply geometry only; use the real virtualizer
    // and its actual scroll event subscriptions rather than mocking the hook.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.tagName === "THEAD") return 64;
      if (this.tagName === "TR") return 41;
      return 600;
    });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(700 * 41 + 64);
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: function (this: HTMLElement, options: ScrollToOptions) {
        const top = options.top ?? this.scrollTop;
        if (this.scrollTop !== top) {
          this.scrollTop = top;
          this.dispatchEvent(new Event("scroll"));
        }
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalScrollTo) {
      Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
    }
  });

  function mountTable() {
    const view = render(<DataTable columns={columns} data={data} virtualizeRows />);
    const scroller = view.container.querySelector<HTMLElement>(".data-table-container")!;
    return { ...view, scroller };
  }

  it("updates the row window on scroll and can reach the final contributor", async () => {
    const { container, scroller, queryByText } = mountTable();
    expect(queryByText("person-0")).not.toBeNull();
    expect(queryByText("person-699")).toBeNull();

    fireEvent.scroll(scroller, { target: { scrollTop: 700 * 41 + 64 - 600 } });
    await waitFor(() => expect(queryByText("person-699")).not.toBeNull());
    expect(queryByText("person-0")).toBeNull();
    expect(container.querySelectorAll("tbody tr[data-index]").length).toBeLessThan(50);

    fireEvent.scroll(scroller, { target: { scrollTop: 0 } });
    await waitFor(() => expect(queryByText("person-0")).not.toBeNull());
    expect(queryByText("person-699")).toBeNull();
  });

  it("resets the scroll window when filtered data is applied and cleared", async () => {
    const { scroller, rerender, queryByText } = mountTable();
    fireEvent.scroll(scroller, { target: { scrollTop: 12000 } });
    expect(queryByText("person-0")).toBeNull();

    rerender(<DataTable columns={columns} data={[data[699]]} virtualizeRows />);
    await waitFor(() => {
      expect(scroller.scrollTop).toBe(0);
      expect(queryByText("person-699")).not.toBeNull();
    });

    rerender(<DataTable columns={columns} data={data} virtualizeRows />);
    await waitFor(() => expect(queryByText("person-0")).not.toBeNull());
    expect(scroller.scrollTop).toBe(0);
  });

  it("resets to the newly sorted first row when sorting from a scrolled position", async () => {
    const { container, scroller, getByRole } = mountTable();
    fireEvent.scroll(scroller, { target: { scrollTop: 12000 } });
    fireEvent.click(getByRole("button", { name: "Contributor" }));
    await waitFor(() => {
      expect(scroller.scrollTop).toBe(0);
      expect(container.querySelector('tbody tr[data-index="0"]')?.textContent).toBe("person-699");
    });
  });

  it("resets the viewport when refreshed data replaces the current rows", async () => {
    const { scroller, rerender, queryByText } = mountTable();
    fireEvent.scroll(scroller, { target: { scrollTop: 12000 } });
    const refreshed = data.map((row) => ({ login: `updated-${row.login}` }));
    rerender(<DataTable columns={columns} data={refreshed} virtualizeRows />);
    await waitFor(() => {
      expect(scroller.scrollTop).toBe(0);
      expect(queryByText("updated-person-0")).not.toBeNull();
    });
  });
});

describe("DataTable row virtualization", () => {
  it("renders only an initial window of a large table, including during SSR", () => {
    const container = renderTable({ virtualizeRows: true });
    const rows = container.querySelectorAll("tbody tr[data-index]");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(50);
    expect(rows[0].textContent).toBe("person-0");
    expect(rows[0].getAttribute("aria-rowindex")).toBe("2");
    expect(container.querySelector("table")?.getAttribute("aria-rowcount")).toBe("701");
    expect(container.querySelector('tr[aria-hidden="true"]')).not.toBeNull();
  });

  it("leaves existing tables unvirtualized by default", () => {
    const container = renderTable({});
    expect(container.querySelectorAll("tbody tr").length).toBe(700);
    expect(container.querySelector("table")?.hasAttribute("aria-rowcount")).toBe(false);
  });

  it("retains the existing pinned-row rendering when pinned rows are provided", () => {
    const container = renderTable({ virtualizeRows: true, pinnedRows: [{ login: "total" }] });
    expect(container.querySelectorAll("tbody tr").length).toBe(701);
    expect(container.querySelector(".pinned-rows-section")?.textContent).toBe("total");
  });
});
