import { test } from "vitest";
import { deepStrictEqual, rejects, strictEqual } from "node:assert/strict";
import { env } from "node:process";
import { Command, CommanderError } from "commander";
import { createCli, normalizeCliArgs } from "./commands.ts";

function fixture() {
  const calls: unknown[] = [];
  const cli = createCli({
    backfill: (options, users) => {
      calls.push(["backfill", options, users]);
      return Promise.resolve();
    },
    createUser: (options) => {
      calls.push(["createUser", options]);
      return Promise.resolve();
    },
    enhancedStats: (options) => {
      calls.push(["enhancedStats", options]);
      return Promise.resolve();
    },
    syncCron: (options) => {
      calls.push(["syncCron", options]);
      return Promise.resolve();
    },
  });
  let output = "";
  const configure = (command: Command) => {
    command.exitOverride().configureOutput({
      writeOut: (text) => {
        output += text;
      },
      writeErr: (text) => {
        output += text;
      },
    });
    command.commands.forEach(configure);
  };
  configure(cli);
  return {
    calls,
    output: () => output,
    parse: (args: string[]) =>
      cli.parseAsync(normalizeCliArgs(args), { from: "user" }),
  };
}

test("CLI keeps legacy aliases, variadic users, env token and camel-case database option", async () => {
  const previous = env.GH_TOKEN;
  env.GH_TOKEN = "test-token";
  try {
    const f = fixture();
    await f.parse([
      "backfill",
      "-r",
      "org/repo",
      "-u",
      "me",
      "-d",
      "postgres://test",
      "-als",
      "alice",
      "bob",
    ]);
    deepStrictEqual(f.calls, [
      [
        "backfill",
        {
          repo: "org/repo",
          username: "me",
          databaseUrl: "postgres://test",
          allLastSeen: true,
          ghToken: "test-token",
        },
        ["alice", "bob"],
      ],
    ]);
    const all = fixture();
    await all.parse([
      "backfill",
      "--repo",
      "org/repo",
      "--username",
      "me",
      "--all",
    ]);
    deepStrictEqual(all.calls, [
      [
        "backfill",
        {
          repo: "org/repo",
          username: "me",
          all: true,
          ghToken: "test-token",
        },
        [],
      ],
    ]);
  } finally {
    if (previous === undefined) delete env.GH_TOKEN;
    else env.GH_TOKEN = previous;
  }
});

test("CLI validates required values before invoking actions", async () => {
  const previous = env.GH_TOKEN;
  delete env.GH_TOKEN;
  try {
    for (const args of [
      ["backfill", "-r", "org/repo", "-u", "me"],
      ["auth", "create-user", "-u", "me"],
      ["backfill-enhanced-pr-stats"],
      ["backfill-enhanced-pr-stats", "-r", "org/repo", "--all-repositories"],
      ["sync-cron", "--unknown"],
    ]) {
      const f = fixture();
      await rejects(f.parse(args), CommanderError);
      deepStrictEqual(f.calls, []);
    }
  } finally {
    if (previous !== undefined) env.GH_TOKEN = previous;
  }
});

test("CLI preserves auth defaults, token flag and maintenance commands", async () => {
  const auth = fixture();
  await auth.parse([
    "auth",
    "create-user",
    "-u",
    "me",
    "-p",
    "-als",
    "--print-token",
  ]);
  deepStrictEqual(auth.calls, [
    [
      "createUser",
      {
        username: "me",
        password: "-als",
        role: "admin",
        printToken: true,
      },
    ],
  ]);
  const enhanced = fixture();
  await enhanced.parse([
    "backfill-enhanced-pr-stats",
    "--all-repositories",
    "--databaseUrl",
    "postgres://test",
  ]);
  deepStrictEqual(enhanced.calls, [
    [
      "enhancedStats",
      {
        allRepositories: true,
        databaseUrl: "postgres://test",
      },
    ],
  ]);
  const cron = fixture();
  await cron.parse(["sync-cron", "-d", "postgres://test"]);
  deepStrictEqual(cron.calls, [
    [
      "syncCron",
      {
        databaseUrl: "postgres://test",
      },
    ],
  ]);
  deepStrictEqual(normalizeCliArgs(["backfill", "--", "-als"]), [
    "backfill",
    "--",
    "-als",
  ]);
});

test("CLI help/version exit successfully without running actions or needing credentials", async () => {
  for (const args of [
    ["--help"],
    ["--version"],
    ["backfill", "--help"],
    ["auth", "create-user", "--help"],
  ]) {
    const f = fixture();
    await rejects(
      f.parse(args),
      (error: unknown) =>
        error instanceof CommanderError && error.exitCode === 0,
    );
    strictEqual(f.output().length > 0, true);
    deepStrictEqual(f.calls, []);
  }
});
