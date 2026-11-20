import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider, useLoaderData } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import CombinedReports from "../routes/app.reports";

const selection = {
  workspaceId: "w1",
  repositoryIds: ["6khJ"],
  report: "authors" as const,
  startDate: "2026-04-10",
  endDate: "2026-09-27",
};
const data = {
  applied: selection,
  defaults: { startDate: selection.startDate, endDate: selection.endDate },
  workspaces: [{ workspaceId: "w1", name: "Workspace", repositoryIds: ["6khJ"] }],
  loadError: null,
  selectionError: null,
  reportError: null,
  result: null,
};

afterEach(cleanup);

it("blocks form submission for a partial date draft and submits only a completed replacement", async () => {
  const loader = vi.fn(() => data);
  const router = createMemoryRouter(
    [
      {
        path: "/app",
        id: "routes/app",
        loader: () => ({
          repositories: [{ id: "6khJ", org: "acme", name: "web" }],
          repositoriesError: false,
        }),
        Component: Outlet,
        HydrateFallback: () => null,
        children: [
          {
            path: "reports",
            loader,
            Component: () => (
              <CombinedReports
                {...({ loaderData: useLoaderData() } as ComponentProps<typeof CombinedReports>)}
              />
            ),
          },
        ],
      },
    ],
    { initialEntries: ["/app/reports"] },
  );
  render(<RouterProvider router={router} />);
  const fetchButton = (await screen.findByRole("button", {
    name: "Fetch report",
  })) as HTMLButtonElement;
  await waitFor(() => expect(fetchButton.disabled).toBe(false));
  const month = screen.getAllByRole("spinbutton")[0];
  fireEvent.keyDown(month, { key: "Backspace" });
  expect(fetchButton.disabled).toBe(true);
  const form = document.getElementById("combined-report-scope") as HTMLFormElement;
  expect(new FormData(form).get("startDate")).toBe("");
  const submission = new Event("submit", { bubbles: true, cancelable: true });
  fireEvent(form, submission);
  expect(submission.defaultPrevented).toBe(true);
  expect(loader).toHaveBeenCalledTimes(1);
  fireEvent(
    month,
    new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertText",
      data: "5",
    }),
  );
  expect(fetchButton.disabled).toBe(false);
  expect(new FormData(form).get("startDate")).toBe("2026-05-10");
  fireEvent.click(fetchButton);
  await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
  expect(new URLSearchParams(router.state.location.search).get("startDate")).toBe("2026-05-10");
  router.dispose();
});
