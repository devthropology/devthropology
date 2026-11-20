import { test } from "vitest";
import { strictEqual } from "node:assert/strict";
import { env } from "node:process";
import { createReportSqlClient, createSqlClient } from "./sqlClient.ts";

test("SQL pools read live environment values and preserve defaults and report fallbacks", async () => {
  const keys = [
    "PG_POOL_MAX",
    "PG_POOL_IDLE_TIMEOUT",
    "PG_POOL_MAX_LIFETIME",
    "PG_CONNECT_TIMEOUT",
    "PG_REPORT_POOL_MAX",
    "PG_REPORT_POOL_IDLE_TIMEOUT",
    "PG_REPORT_POOL_MAX_LIFETIME",
    "PG_REPORT_CONNECT_TIMEOUT",
  ];
  const previous = keys.map((key) => env[key]);
  const clients: ReturnType<typeof createSqlClient>[] = [];
  // postgres creates connections lazily; inspecting options needs no database.
  const create = (report = false) => {
    const client = (report ? createReportSqlClient : createSqlClient)(
      "postgres://test:test@localhost:1/test",
    );
    clients.push(client);
    return client.options;
  };

  try {
    for (const key of keys) delete env[key];
    const defaults = create();
    strictEqual(defaults.max, 10);
    strictEqual(defaults.idle_timeout, 30);
    strictEqual(defaults.max_lifetime, 600);
    strictEqual(defaults.connect_timeout, 3);

    env.PG_POOL_MAX = "4";
    env.PG_POOL_IDLE_TIMEOUT = "12";
    env.PG_POOL_MAX_LIFETIME = "90";
    env.PG_CONNECT_TIMEOUT = "5";
    const fallback = create(true);
    strictEqual(fallback.max, 4);
    strictEqual(fallback.idle_timeout, 12);
    strictEqual(fallback.max_lifetime, 90);
    strictEqual(fallback.connect_timeout, 5);

    env.PG_REPORT_POOL_MAX = "2";
    strictEqual(create(true).max, 2);
    strictEqual(create().max, 4);

    for (const value of ["", "invalid", "0", "-1"]) {
      env.PG_REPORT_POOL_MAX = value;
      strictEqual(create(true).max, 4);
      env.PG_POOL_IDLE_TIMEOUT = value;
      strictEqual(create().idle_timeout, 30);
    }

    delete env.PG_POOL_MAX;
    strictEqual(create(true).max, 10);
  } finally {
    keys.forEach((key, index) => {
      const value = previous[index];
      if (value === undefined) delete env[key];
      else env[key] = value;
    });
    await Promise.all(clients.map((client) => client.end()));
  }
});
