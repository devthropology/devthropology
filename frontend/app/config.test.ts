import { describe, expect, it, vi } from "vitest";
import { apiFetch, getForwardableClientIp } from "./config";

describe("getForwardableClientIp", () => {
  it("prefers cf-connecting-ip over generic proxy headers", () => {
    const request = new Request("https://example.com/app", {
      headers: {
        "cf-connecting-ip": "198.51.100.24",
        "x-forwarded-for": "203.0.113.10, 172.70.230.153",
        "x-real-ip": "198.51.100.24",
      },
    });

    expect(getForwardableClientIp(request)).toBe("198.51.100.24");
  });

  it("falls back to the first x-forwarded-for ip when cloudflare headers are absent", () => {
    const request = new Request("https://example.com/app", {
      headers: {
        "x-forwarded-for": "203.0.113.10, 172.70.230.153",
      },
    });

    expect(getForwardableClientIp(request)).toBe("203.0.113.10");
  });

  it("falls back to x-real-ip when no other client ip exists", () => {
    const request = new Request("https://example.com/app", {
      headers: {
        "x-real-ip": "198.51.100.24",
      },
    });

    expect(getForwardableClientIp(request)).toBe("198.51.100.24");
  });
});

describe("apiFetch retry behavior", () => {
  it("retries 503 responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const response = await apiFetch("https://api.example.com/health", {
        retryDelayMs: 0,
      });

      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(5);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not retry 403 responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const response = await apiFetch("https://api.example.com/health");

      expect(response.status).toBe(403);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
