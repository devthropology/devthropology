import { test } from "vitest";
import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { isTransientDatabaseConnectionError } from "./isTransientDatabaseConnectionError.ts";

test("detects transient network, driver, and PostgreSQL error codes", () => {
  for (const code of [
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "EPIPE",
    "ENOTFOUND",
    "EAI_AGAIN",
    "CONNECT_TIMEOUT",
    "CONNECTION_CLOSED",
    "CONNECTION_ENDED",
    "CONNECTION_DESTROYED",
    "57P01",
    "57P02",
    "57P03",
    "53300",
    "08006",
  ]) {
    assertEquals(isTransientDatabaseConnectionError({ code }), true, code);
    assertEquals(
      isTransientDatabaseConnectionError({ cause: { code } }),
      true,
      `nested ${code}`,
    );
  }
});

test("detects postgres startup messages", () => {
  assertEquals(
    isTransientDatabaseConnectionError(
      "the database system is not yet accepting connections",
    ),
    true,
  );
});

test("detects nested transient connection errors", () => {
  assertEquals(
    isTransientDatabaseConnectionError({
      message: "query failed",
      cause: { message: "connect ECONNREFUSED 127.0.0.1:5432" },
    }),
    true,
  );
});

test("ignores non-transient errors", () => {
  assertEquals(
    isTransientDatabaseConnectionError({ message: "relation does not exist" }),
    false,
  );
});
