import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock, sessionMock } = vi.hoisted(() => ({ fetchMock: vi.fn(), sessionMock: vi.fn() }));
vi.mock("../config", () => ({ API_URL: "http://backend.test", authenticatedFetch: fetchMock }));
vi.mock("../utils/session.server", () => ({
  requireUserSession: sessionMock,
}));
import { loader } from "../routes/app.reports";

const workspace = { workspaceId: "w1", name: "Workspace", repositoryIds: ["6khJ", "LgYX"] };
function args(query = "") {
  const url = new URL(`http://frontend.test/app/reports${query}`);
  return { request: new Request(url), url } as Parameters<typeof loader>[0];
}
const query =
  "?workspaceId=w1&report=authors&repositoryIds=6khJ&repositoryIds=LgYX&startDate=2026-01-01&endDate=2026-02-01";

beforeEach(() => {
  sessionMock.mockReset();
  sessionMock.mockResolvedValue({ token: "test-token", role: "superuser" });
  fetchMock.mockReset();
  fetchMock.mockResolvedValueOnce(Response.json([workspace]));
});

describe("combined report loader", () => {
  it.each(["demo", "user"])(
    "denies %s users before requesting workspace or report data",
    async (role) => {
      sessionMock.mockResolvedValue({ token: "test-token", role });
      const response = await loader(args(query)).catch((error: unknown) => error);
      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it("does not query reports before Fetch", async () => {
    const data = await loader(args());
    expect(data.applied).toBeNull();
    expect(data.result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["authors", "reviewers"])(
    "accepts public IDs and loads one %s report",
    async (report) => {
      fetchMock.mockResolvedValueOnce(Response.json({ [report]: [], thresholds: [] }));
      const data = await loader(args(query.replace("report=authors", `report=${report}`)));
      expect(data.selectionError).toBeNull();
      expect(data.reportError).toBeNull();
      expect(data.result).toEqual({ report, data: { [report]: [], thresholds: [] } });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const url = new URL(fetchMock.mock.calls[1][0]);
      expect(url.pathname).toBe(`/api/reports/${report}`);
      expect(url.searchParams.getAll("repositoryIds")).toEqual(["6khJ", "LgYX"]);
      expect(url.searchParams.get("workspaceId")).toBe("w1");
    },
  );

  it("rejects repositories outside the workspace before fetching", async () => {
    const data = await loader(args(query.replace("LgYX", "other")));
    expect(data.selectionError).toMatch(/workspace/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid calendar dates before fetching", async () => {
    const data = await loader(args(query.replace("2026-01-01", "2026-02-30")));
    expect(data.selectionError).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the applied scope but distinguishes failed reports from empty results", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const data = await loader(args(query));
    expect(data.applied?.repositoryIds).toEqual(["6khJ", "LgYX"]);
    expect(data.result).toBeNull();
    expect(data.reportError).toMatch(/try again/);
  });

  it("handles access revoked between workspace selection and reporting", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
    const data = await loader(args(query));
    expect(data.result).toBeNull();
    expect(data.reportError).toMatch(/access/);
  });
});
