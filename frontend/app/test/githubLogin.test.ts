// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeGithubLogin, startGithubLogin } from "../utils/githubLogin.server";
import { getUserSession } from "../utils/session.server";

vi.mock("~/config", () => ({ API_URL: "https://backend.test" }));

const fetchMock = vi.fn();
const state = "a".repeat(64);
const authorizationUrl = `https://github.com/login/oauth/authorize?state=${state}`;
const account = {
  userId: "f0b67e0c-bdd9-48d7-b41b-003f96e3a1cf",
  username: "octocat",
  role: "user",
  token: "application-token",
  redirectTo: "/app/settings",
};

function startRequest(origin = "https://frontend.test", redirectTo = "/app") {
  return new Request("https://frontend.test/auth/github", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ redirectTo }),
  });
}

async function start() {
  fetchMock.mockResolvedValueOnce(Response.json({ authorizationUrl }));
  const response = await startGithubLogin(startRequest());
  const cookie = response.headers.get("Set-Cookie")!.split(";")[0];
  return { response, cookie };
}

function callback(cookie?: string, extra = "code=provider-code") {
  return new Request(`https://frontend.test/auth/github/callback?state=${state}&${extra}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

describe("GitHub App frontend login", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("binds start to an HTTP-only secure browser cookie and sanitizes redirects", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ authorizationUrl }));
    const response = await startGithubLogin(
      startRequest("https://frontend.test", "https://evil.test"),
    );
    expect(response.headers.get("Location")).toBe(authorizationUrl);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const cookie = response.headers.get("Set-Cookie");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Max-Age=600");
    expect(fetchMock.mock.calls[0][1].redirect).toBe("manual");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.redirectTo).toBe("/app");
    expect(body.browserSecret).toMatch(/^[a-f0-9]{64}$/);
    expect(response.headers.get("Location")).not.toContain(body.browserSecret);
  });

  it("rejects cross-site starts and callbacks without a browser cookie", async () => {
    expect((await startGithubLogin(startRequest("https://evil.test"))).status).toBe(403);
    const response = await completeGithubLogin(callback());
    expect(response.headers.get("Location")).toBe("/login?githubError=invalid_state");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("establishes the existing app session through a server-to-server exchange", async () => {
    const { cookie } = await start();
    fetchMock.mockResolvedValueOnce(Response.json(account));
    const response = await completeGithubLogin(callback(cookie));
    expect(fetchMock.mock.calls[1][0]).toBe("https://backend.test/api/auth/github/callback");
    expect(fetchMock.mock.calls[1][1].redirect).toBe("manual");
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.state).toBe(state);
    expect(body.code).toBe("provider-code");
    expect(body.browserSecret).toMatch(/^[a-f0-9]{64}$/);
    expect(response.headers.get("Location")).toBe("/app/settings");
    expect(response.headers.get("Location")).not.toContain(account.token);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const cookies = response.headers.getSetCookie();
    expect(
      cookies.some((c) => c.startsWith("__Host-github_login=") && c.includes("Max-Age=0")),
    ).toBe(true);
    expect(
      cookies.some((c) => c.startsWith("selectedRepositoryId=") && c.includes("Max-Age=0")),
    ).toBe(true);
    const sessionCookie = cookies.find((c) => c.startsWith("__session="))!.split(";")[0];
    expect(
      await getUserSession(
        new Request("https://frontend.test/app", { headers: { Cookie: sessionCookie } }),
      ),
    ).toEqual({
      userId: account.userId,
      username: account.username,
      role: account.role,
      token: account.token,
    });
  });

  it("shows setup and denied-consent errors, clears attempts, and never retries failures", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "not_configured" }, { status: 503 }));
    expect((await startGithubLogin(startRequest())).headers.get("Location")).toBe(
      "/login?githubError=not_configured",
    );
    const { cookie } = await start();
    fetchMock.mockResolvedValueOnce(Response.json({ error: "denied" }, { status: 400 }));
    const response = await completeGithubLogin(callback(cookie, "error=access_denied"));
    expect(response.headers.get("Location")).toBe("/login?githubError=denied");
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([301, 302, 303, 307, 308])(
    "rejects backend redirects (%i) without following them",
    async (status) => {
      fetchMock.mockResolvedValueOnce(
        Response.json(
          { authorizationUrl },
          {
            status,
            headers: { Location: "https://other.test" },
          },
        ),
      );
      expect((await startGithubLogin(startRequest())).headers.get("Location")).toBe(
        "/login?githubError=unavailable",
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][1].redirect).toBe("manual");

      const { cookie } = await start();
      fetchMock.mockResolvedValueOnce(
        Response.json(account, {
          status,
          headers: { Location: "https://other.test" },
        }),
      );
      expect((await completeGithubLogin(callback(cookie))).headers.get("Location")).toBe(
        "/login?githubError=unavailable",
      );
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls[2][1].redirect).toBe("manual");
    },
  );

  it("sanitizes callback destinations and recovers from backend failures", async () => {
    const { cookie } = await start();
    fetchMock.mockResolvedValueOnce(Response.json({ ...account, redirectTo: "//evil.test" }));
    expect((await completeGithubLogin(callback(cookie))).headers.get("Location")).toBe("/app");
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect((await completeGithubLogin(callback(cookie))).headers.get("Location")).toBe(
      "/login?githubError=unavailable",
    );
  });
});
