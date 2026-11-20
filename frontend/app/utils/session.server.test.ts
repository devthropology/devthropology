import { afterEach, describe, expect, it, vi } from "vitest";

import { getSessionSecrets, requireUserSession, sanitizeRedirectTarget } from "./session.server";

describe("getSessionSecrets", () => {
  it("splits and trims comma-separated secrets", () => {
    expect(getSessionSecrets({ SESSION_SECRET: " new , old ," })).toEqual(["new", "old"]);
  });

  it("falls back to a dev secret outside production", () => {
    expect(getSessionSecrets({})).toEqual(["dev-only-insecure-session-secret"]);
  });

  describe("in production", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("requires a secret", () => {
      vi.stubEnv("PROD", true);
      expect(() => getSessionSecrets({ SESSION_SECRET: " , " })).toThrow(
        "SESSION_SECRET must be set in production",
      );
    });
  });
});

describe("sanitizeRedirectTarget", () => {
  it("keeps in-app destinations", () => {
    expect(sanitizeRedirectTarget("/app/r/demo/explore/contributors/alice?tab=activity")).toBe(
      "/app/r/demo/explore/contributors/alice?tab=activity",
    );
  });

  it("rejects external and non-app destinations", () => {
    expect(sanitizeRedirectTarget("https://example.com/app")).toBe("/app");
    expect(sanitizeRedirectTarget("//example.com/app")).toBe("/app");
    expect(sanitizeRedirectTarget("/login")).toBe("/app");
  });
});

describe("requireUserSession", () => {
  it.each(["/app/reports.data?_routes=reports", "/app/reports/_.data?_routes=reports"])(
    "uses the normalized route URL for login redirects from %s",
    async (path) => {
      const request = new Request(`http://example.com${path}&report=authors`);
      const url = new URL("http://example.com/app/reports?report=authors");
      const response = await requireUserSession(request, url).catch((error: unknown) => error);
      expect(response).toBeInstanceOf(Response);
      expect((response as Response).headers.get("Location")).toBe(
        "/login?redirectTo=%2Fapp%2Freports%3Freport%3Dauthors",
      );
    },
  );

  it("redirects unauthenticated users to login with the original destination", async () => {
    const request = new Request(
      "http://example.com/app/r/demo/explore/contributors/alice?tab=activity",
    );

    let thrown: unknown;

    try {
      await requireUserSession(request);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(302);
    expect((thrown as Response).headers.get("Location")).toBe(
      "/login?redirectTo=%2Fapp%2Fr%2Fdemo%2Fexplore%2Fcontributors%2Falice%3Ftab%3Dactivity",
    );
  });
});
