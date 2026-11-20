import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { describe, it } from "vitest";
import { getRequestIp } from "./requestIp.ts";

describe("getRequestIp", () => {
  it("prefers the app's forwarded client ip over cloudflare and proxy headers", () => {
    const headers = new Headers({
      "cf-connecting-ip": "104.23.225.149",
      "x-devthropology-client-ip": "203.0.113.10",
      "x-real-ip": "203.0.113.10",
      "x-forwarded-for": "203.0.113.10, 104.23.225.149",
    });

    assertEquals(getRequestIp(headers, null), "203.0.113.10");
  });

  it("prefers cf-connecting-ip over generic proxy headers for direct requests", () => {
    const headers = new Headers({
      "cf-connecting-ip": "198.51.100.24",
      "x-real-ip": "172.70.111.73",
      "x-forwarded-for": "172.70.111.73, 10.0.0.12",
    });

    assertEquals(getRequestIp(headers, null), "198.51.100.24");
  });

  it("falls back to x-real-ip when cloudflare headers are absent", () => {
    const headers = new Headers({
      "x-real-ip": "203.0.113.10",
    });

    assertEquals(getRequestIp(headers, null), "203.0.113.10");
  });

  it("falls back to remote address when no headers exist", () => {
    assertEquals(getRequestIp(new Headers(), "127.0.0.1"), "127.0.0.1");
  });
});
