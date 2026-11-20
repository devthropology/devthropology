import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { expect, test } from "vitest";
import { writeGithubArchive } from "./githubArchiveWriter.ts";

test("publishes complete zstd JSON and never replaces another writer's files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "archive-writer-"));
  const file = join(dir, "capture.json.zst");
  try {
    await writeGithubArchive(file, { original: true }, 6);
    const original = await readFile(file);
    expect(JSON.parse(zstdDecompressSync(original).toString())).toEqual({
      original: true,
    });
    await expect(
      writeGithubArchive(file, { original: false }, 6),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(file)).toEqual(original);
    expect(await readdir(dir)).toEqual(["capture.json.zst"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
