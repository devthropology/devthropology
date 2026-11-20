import { cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it } from "vitest";
import { Sidebar } from "./Sidebar";

afterEach(cleanup);

it.each(["demo", "user", "superuser"])("keeps combined reports out of the sidebar: %s", (role) => {
  const router = createMemoryRouter(
    [
      {
        path: "/app",
        Component: () => (
          <Sidebar
            user={{ userId: "u1", username: "test", role, token: "test-token" }}
            repositories={[]}
            selectedRepository={null}
            initialRailMode={false}
            isMobileOpen={false}
            onMobileClose={() => {}}
            isCompactLayout={false}
            enableLayoutTransitions={false}
          />
        ),
      },
    ],
    { initialEntries: ["/app"] },
  );
  render(<RouterProvider router={router} />);
  expect(screen.queryByRole("link", { name: "Combined Reports" })).toBeNull();
  expect(screen.getByRole("link", { name: "Home" })).toBeTruthy();
  router.dispose();
});
