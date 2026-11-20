import { strictEqual } from "node:assert/strict";
import { once } from "node:events";
import process from "node:process";
import { Hono } from "hono";
import { createHttpServer } from "../backend/httpServer.ts";
import { createCli } from "../backend/cli/commands.ts";
import { parseEnv } from "../backend/util/loadEnv.ts";
// Exercise the application dependency graph, including TypeScript enums and
// parameter properties, using the production Node runtime.
import { Service } from "../backend/service.ts";
import { GithubConnectionsService } from "../backend/features/githubConnections/githubConnectionsService.ts";
import { GithubInstallationCredentials } from "../backend/features/sync/githubSyncCredentials.ts";
import { TrendsService } from "../backend/features/trends/trendsService.ts";

strictEqual(
  Number(process.versions.node.split(".")[0]),
  26,
  "Run this check with Node 26",
);
strictEqual(
  Temporal.PlainDate.from("2026-02-28").add({ days: 1 }).toString(),
  "2026-03-01",
);
strictEqual(
  Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(
    "America/New_York",
  ).year,
  1969,
);
for (const service of [
  Service,
  GithubConnectionsService,
  GithubInstallationCredentials,
  TrendsService,
]) {
  strictEqual(typeof service, "function");
}
strictEqual(parseEnv("BASE=value\nEXPANDED=$BASE", {}).EXPANDED, "value");

let dispatched = false;
const unexpected = () => Promise.reject(new Error("Unexpected CLI action"));
await createCli({
  backfill: unexpected,
  createUser: unexpected,
  enhancedStats: unexpected,
  syncCron: (options) => {
    strictEqual(options.databaseUrl, "postgres://test");
    dispatched = true;
    return Promise.resolve();
  },
}).parseAsync(["sync-cron", "-d", "postgres://test"], { from: "user" });
strictEqual(dispatched, true);

const app = new Hono();
app.post("/echo", async (c) => c.json(await c.req.json()));
const server = createHttpServer(
  app.fetch,
  () => new Response("error", { status: 500 }),
);
try {
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await listening;
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("No TCP address");
  }
  const response = await fetch(`http://127.0.0.1:${address.port}/echo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Node 26" }),
  });
  strictEqual(response.status, 200);
  strictEqual((await response.json()).message, "Node 26");
} finally {
  const closed = once(server, "close");
  server.close();
  server.closeAllConnections();
  await closed;
}
// Also load the real app/bootstrap module without starting its production server
// or sending telemetry.
const previousDsn = process.env.SENTRY_DSN;
process.env.SENTRY_DSN = "";
try {
  const { createApp } = await import("../backend/main.ts");
  strictEqual(typeof createApp, "function");
} catch (error) {
  // main installs fatal-error listeners even when imported. Keep this smoke
  // check failing if one of those listeners handles an import/assertion error.
  process.exitCode = 1;
  throw error;
} finally {
  if (previousDsn === undefined) delete process.env.SENTRY_DSN;
  else process.env.SENTRY_DSN = previousDsn;
}
console.log(
  `Node ${process.versions.node}: imports, Temporal, CLI and HTTP checks passed`,
);
