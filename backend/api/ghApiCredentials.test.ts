import { test } from "vitest";
import {
  deepStrictEqual as assertEquals,
  rejects as assertRejects,
} from "node:assert/strict";
import { GhApi } from "./ghApi.ts";

test("GhApi uses injected credentials on each request and preserves legacy callers", async () => {
  const original = globalThis.fetch;
  const authorizations: (string | null)[] = [];
  globalThis.fetch = (_input, init) => {
    authorizations.push(new Headers(init?.headers).get("Authorization"));
    return Promise.resolve(Response.json([{ number: 1 }]));
  };
  try {
    let calls = 0;
    const api = new GhApi("owner", "repo", "legacy", "key", {
      getAuthorizationHeader: () => Promise.resolve(`Bearer app-${++calls}`),
    });
    assertEquals(await api.getMostRecentIssue(), 1);
    assertEquals(await api.getMostRecentIssue(), 1);
    await new GhApi("owner", "repo", "legacy", "key").getMostRecentIssue();
    await new GhApi("owner", "repo", "", undefined).getMostRecentIssue();
    await new GhApi("owner", "repo", "usér", "tøken").getMostRecentIssue();
    assertEquals(authorizations, [
      "Bearer app-1",
      "Bearer app-2",
      `Basic ${btoa("legacy:key")}`,
      null,
      `Basic ${btoa(
        String.fromCharCode(...new TextEncoder().encode("usér:tøken")),
      )}`,
    ]);
  } finally {
    globalThis.fetch = original;
  }
});

test("GhApi never sends a request when an injected provider fails or returns empty credentials", async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = () => {
    requests++;
    return Promise.resolve(Response.json([{ number: 1 }]));
  };
  try {
    for (const getAuthorizationHeader of [
      () => Promise.resolve(""),
      () => Promise.resolve("   "),
      () => Promise.reject(new Error("Installation revoked")),
    ]) {
      await assertRejects(() =>
        new GhApi("owner", "public-repo", "legacy", "key", {
          getAuthorizationHeader,
        }).getMostRecentIssue(),
      );
    }
    assertEquals(requests, 0);
  } finally {
    globalThis.fetch = original;
  }
});
