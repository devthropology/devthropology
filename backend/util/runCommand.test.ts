import { test } from "vitest";
import { rejects, strictEqual } from "node:assert/strict";
import process from "node:process";
import { runCommand } from "./runCommand.ts";

const evalArgs = (source: string) => ["--input-type=module", "-e", source];

test("runCommand captures UTF-8 output, inherits env and passes arguments without a shell", async () => {
  const key = "DEVTHROPOLOGY_COMMAND_TEST";
  const previous = process.env[key];
  try {
    process.env[key] = "inherited";
    const result = await runCommand(
      process.execPath,
      [
        ...evalArgs(`
        import process from "node:process";
        console.log(process.env.${key});
        console.log(process.env.COMMAND_OVERRIDE);
        console.log(process.argv.at(-1));
        console.error("é中文");
      `),
        "$(echo not-a-shell); spaces",
      ],
      { env: { COMMAND_OVERRIDE: "override" } },
    );
    strictEqual(result.success, true);
    strictEqual(result.code, 0);
    strictEqual(result.signal, null);
    strictEqual(
      result.stdout,
      "inherited\noverride\n$(echo not-a-shell); spaces\n",
    );
    strictEqual(result.stderr, "é中文\n");
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

test("runCommand returns nonzero exits rather than rejecting", async () => {
  const result = await runCommand(
    process.execPath,
    evalArgs(`
    import process from "node:process";
    console.error("failure");
    process.exit(7);
  `),
  );
  strictEqual(result.success, false);
  strictEqual(result.code, 7);
  strictEqual(result.stderr, "failure\n");
});

test("runCommand can discard stdout and rejects spawn failures", async () => {
  const result = await runCommand(
    process.execPath,
    evalArgs('console.log("discard"); console.error("keep");'),
    { discardStdout: true },
  );
  strictEqual(result.stdout, "");
  strictEqual(result.stderr, "keep\n");
  await rejects(runCommand(`missing-command-${crypto.randomUUID()}`, []), {
    code: "ENOENT",
  });
});

test("runCommand drains output larger than execFile's default buffer", async () => {
  const result = await runCommand(
    process.execPath,
    evalArgs('console.log("x".repeat(2 * 1024 * 1024));'),
  );
  strictEqual(result.success, true);
  strictEqual(result.stdout.length, 2 * 1024 * 1024 + 1);
});
