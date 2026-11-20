import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireUserSessionMock } = vi.hoisted(() => ({ requireUserSessionMock: vi.fn() }));
vi.mock("../utils/session.server", () => ({ requireUserSession: requireUserSessionMock }));
vi.mock("../pages/adminSettings", () => ({ default: () => null }));

import { loader } from "../routes/app.admin";
import { loader as legacyLoader } from "../routes/app.r.$repoRef.admin.settings";

const args = { request: new Request("http://example.com/app/admin") } as Parameters<
  typeof loader
>[0];
beforeEach(() => vi.clearAllMocks());

describe("global admin center", () => {
  it("allows superusers without a selected repository", async () => {
    const user = { username: "root", role: "superuser", token: "test-token" };
    requireUserSessionMock.mockResolvedValue(user);
    expect(await loader(args)).toEqual({ user });
  });

  it.each(["user", "demo", "admin"])("rejects %s accounts", async (role) => {
    requireUserSessionMock.mockResolvedValue({ role });
    await expect(loader(args)).rejects.toMatchObject({ status: 403 });
  });

  it("preserves login redirects", async () => {
    const response = new Response(null, { status: 302, headers: { Location: "/login" } });
    requireUserSessionMock.mockRejectedValue(response);
    await expect(loader(args)).rejects.toBe(response);
  });

  it("redirects old repository settings to global settings", async () => {
    requireUserSessionMock.mockResolvedValue({ role: "user" });
    const response = await legacyLoader({ request: args.request } as Parameters<
      typeof legacyLoader
    >[0]);
    expect(response.headers.get("Location")).toBe("/app/settings");
  });
});
