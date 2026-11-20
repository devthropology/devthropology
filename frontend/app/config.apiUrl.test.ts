import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllEnvs());

describe("self-hosted API URLs", () => {
  it("resolves browser URL constructors against the frontend origin", async () => {
    vi.stubEnv("SELF_HOSTED", "true");
    vi.stubEnv("SSR", false);
    const { API_URL } = await import("./config");
    expect(API_URL).toBe(window.location.origin);
    // Both lazy filesystem loading and the sync EventSource construct URLs this way.
    for (const path of ["/api/filesystem/tree", "/api/sync/stream"]) {
      const url = new URL(`${API_URL}${path}`);
      expect(url.origin).toBe(window.location.origin);
      expect(url.pathname).toBe(path);
    }
  });

  it("keeps SSR requests pointed at the configured backend", async () => {
    vi.stubEnv("SELF_HOSTED", "true");
    vi.stubEnv("SSR", true);
    vi.stubEnv("VITE_BACKEND_API_URL", "http://backend.internal:8003");
    const { API_URL } = await import("./config");
    expect(API_URL).toBe("http://backend.internal:8003");
  });

  it("preserves the Cloudflare production API URL", async () => {
    vi.stubEnv("SELF_HOSTED", undefined);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VITE_BACKEND_API_URL", "https://api.example.com");
    const { API_URL } = await import("./config");
    expect(API_URL).toBe("https://api.example.com");
  });
});
