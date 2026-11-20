// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectionRequest, ConnectionRequestError } from "../utils/githubConnections.server";

vi.mock("../config", () => ({
  API_URL: "https://backend.test",
  authenticatedFetch: vi.fn(),
}));
import { authenticatedFetch } from "../config";

const fetchMock = vi.mocked(authenticatedFetch);
const request = new Request("https://frontend.test/app/settings");

describe("GitHub connection backend redirect handling", () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it("uses Workers-compatible manual redirects for authenticated requests", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ connections: [] }));
    expect(await connectionRequest(request, "test-token", "connections")).toEqual({
      connections: [],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://backend.test/api/github-connections/connections",
      "test-token",
      expect.objectContaining({ redirect: "manual", retryCount: 0 }),
    );
  });

  it.each([301, 302, 303, 307, 308])(
    "rejects redirects (%i) before consuming their body",
    async (status) => {
      const response = new Response("not JSON", {
        status,
        headers: { Location: "https://other.test" },
      });
      const json = vi.spyOn(response, "json");
      fetchMock.mockResolvedValueOnce(response);
      await expect(connectionRequest(request, "test-token", "start", {})).rejects.toBeInstanceOf(
        ConnectionRequestError,
      );
      expect(json).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
});
