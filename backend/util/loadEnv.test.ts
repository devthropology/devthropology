import { test } from "vitest";
import {
  deepStrictEqual,
  rejects,
  strictEqual,
  throws,
} from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "node:process";
import { loadEnv, parseEnv } from "./loadEnv.ts";

test("environment parser preserves quoting, comments, escapes and expansion rules", () => {
  deepStrictEqual(
    parseEnv(
      String.raw`
# comment
export FILE_VALUE=file
EMPTY=
TRIMMED= spaces # comment
SINGLE=' $FILE_VALUE\n '
DOUBLE=" $FILE_VALUE\n\t "
FORWARD=$LATER
LATER=late
FILE_FIRST=$FILE_VALUE
ENV_ONLY=$EXTERNAL
FALLBACK=${"${ABSENT:-${ALSO_MISSING:-fallback}}"}
EMPTY_FALLBACK=${"${EMPTY:-fallback}"}
ESCAPED=\$FILE_VALUE
MISSING=$UNSET
MULTILINE="first
second"
`,
      { FILE_VALUE: "external", EXTERNAL: "environment" },
    ),
    {
      FILE_VALUE: "file",
      EMPTY: "",
      TRIMMED: "spaces",
      SINGLE: " $FILE_VALUE\\n ",
      DOUBLE: " $FILE_VALUE\n\t ",
      FORWARD: "late",
      LATER: "late",
      FILE_FIRST: "file",
      ENV_ONLY: "environment",
      FALLBACK: "fallback",
      EMPTY_FALLBACK: "",
      ESCAPED: "\\$FILE_VALUE",
      MISSING: "undefined",
      MULTILINE: "first\nsecond",
    },
  );
  throws(() => parseEnv("A=$B\nB=$A", {}), /Cyclic/);
});

test("loadEnv preserves existing env, loads UTF-8 and only ignores missing files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "load-env-"));
  const path = join(directory, ".env");
  const keys = ["ENV_TEST_EXISTING", "ENV_TEST_EMPTY", "ENV_TEST_LOADED"];
  const previous = keys.map((key) => env[key]);
  try {
    await loadEnv(path);
    env.ENV_TEST_EXISTING = "external";
    env.ENV_TEST_EMPTY = "";
    delete env.ENV_TEST_LOADED;
    await writeFile(
      path,
      "ENV_TEST_EXISTING=file\nENV_TEST_EMPTY=file\nENV_TEST_LOADED=é中文\n",
    );
    await loadEnv(path);
    strictEqual(env.ENV_TEST_EXISTING, "external");
    strictEqual(env.ENV_TEST_EMPTY, "");
    strictEqual(env.ENV_TEST_LOADED, "é中文");
    await rejects(loadEnv(directory));
  } finally {
    keys.forEach((key, i) => {
      if (previous[i] === undefined) delete env[key];
      else env[key] = previous[i];
    });
    await rm(directory, { recursive: true, force: true });
  }
});
