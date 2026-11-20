import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { afterEach, expect, test, vi } from "vitest";
import { readGithubArchiveConfig } from "./githubArchiveConfig.ts";
import { createGithubArchive } from "./githubArchiveService.ts";
import {
  GithubArchiveError,
  type GithubArchiveSnapshot,
} from "./githubArchiveTypes.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
async function config(overrides: NodeJS.ProcessEnv = {}) {
  const directory = await mkdtemp(join(tmpdir(), "github-archive-test-"));
  directories.push(directory);
  return readGithubArchiveConfig({
    GH_ARCHIVE_DIR: directory,
    GH_ARCHIVE_LOCAL: "true",
    ...overrides,
  });
}
const repository = { owner: "org", name: "repo" };
const snapshot: GithubArchiveSnapshot = {
  number: 42,
  type: "pull_request",
  fetchedAt: "2026-01-01T00:00:00.000Z",
  responses: [
    {
      endpoint: "https://api.github.com/repos/org/repo/pulls/42",
      status: 200,
      response: { unmodeledField: "preserved" },
    },
    {
      endpoint: "https://api.github.com/repos/org/repo/pulls/42/files?page=1",
      status: 200,
      response: [{ patch: "@@ raw diff" }],
    },
    {
      endpoint: "https://api.github.com/repos/org/repo/pulls/42/files?page=2",
      status: 200,
      response: [],
    },
  ],
};
async function files(directory: string) {
  return (await readdir(directory, { recursive: true })).filter((p) =>
    p.endsWith(".json.zst"),
  );
}

test("disabled creates no files or uploader work", async () => {
  const c = await config({ GH_ARCHIVE_LOCAL: "false" });
  const upload = vi.fn();
  expect(createGithubArchive(repository, c, upload)).toBeUndefined();
  expect(await readdir(c.directory)).toEqual([]);
  expect(upload).not.toHaveBeenCalled();
});

test("native zstd captures raw pages, metadata, and distinct immutable snapshots", async () => {
  const c = await config();
  const archive = createGithubArchive(repository, c)!;
  await Promise.all([archive.save(snapshot), archive.save(snapshot)]);
  const captures = await files(c.directory);
  expect(captures).toHaveLength(2);
  for (const file of captures) {
    expect(file).toMatch(/^gh_api_archive\/org\/repo\/42\/.*\.json.zst$/);
    const path = join(c.directory, file);
    const record = JSON.parse(
      zstdDecompressSync(await readFile(path)).toString(),
    );
    expect(record).toMatchObject({ ...snapshot, version: 1, repository });
    expect(file).toContain(record.captureId);
    expect(record.captureId).toMatch(/^\d{4}_\d{2}_\d{2}_\d{6}_\d{3}Z$/);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  }
  expect(
    (await readdir(c.directory, { recursive: true })).some((p) =>
      p.endsWith(".partial"),
    ),
  ).toBe(false);
});

test("S3-only deletes staged data only after a successful upload", async () => {
  const c = await config({
    GH_ARCHIVE_LOCAL: "false",
    GH_ARCHIVE_S3: "true",
    GH_ARCHIVE_S3_BUCKET: "bucket",
  });
  const upload = vi.fn(async (file: string) => {
    expect((await readFile(file)).length).toBeGreaterThan(0);
  });
  const archive = createGithubArchive(repository, c, upload)!;
  await archive.save(snapshot);
  expect(upload).not.toHaveBeenCalled();
  expect(await files(c.directory)).toHaveLength(1);
  expect(await archive.uploadPending()).toBe(1);
  expect(await files(c.directory)).toEqual([]);
  expect(await archive.uploadPending()).toBe(0);
  expect(upload).toHaveBeenCalledTimes(1);
});

test("changing destination never sends old pending captures to a new bucket", async () => {
  const c = await config({
    GH_ARCHIVE_S3: "true",
    GH_ARCHIVE_S3_BUCKET: "old-bucket",
  });
  const archive = createGithubArchive(
    repository,
    c,
    vi.fn().mockRejectedValue(new Error("offline")),
  )!;
  await archive.save(snapshot);
  await expect(archive.uploadPending()).rejects.toThrow();
  const upload = vi.fn();
  await createGithubArchive(
    repository,
    { ...c, bucket: "new-bucket" },
    upload,
  )!.uploadPending();
  expect(upload).not.toHaveBeenCalled();
  expect(await files(c.directory)).toHaveLength(1);
});

test("write errors propagate; never upload an unfinished capture", async () => {
  const c = await config({
    GH_ARCHIVE_S3: "true",
    GH_ARCHIVE_S3_BUCKET: "bucket",
  });
  await writeFile(join(c.directory, ".pending"), "not a directory");
  const upload = vi.fn();
  await expect(
    createGithubArchive(repository, c, upload)!.save(snapshot),
  ).rejects.toBeInstanceOf(GithubArchiveError);
  expect(upload).not.toHaveBeenCalled();
});

test("repo names and issue numbers cannot escape the archive directory", async () => {
  const c = await config();
  expect(() => createGithubArchive({ owner: "..", name: "repo" }, c)).toThrow();
  await expect(
    createGithubArchive(repository, c)!.save({ ...snapshot, number: -1 }),
  ).rejects.toThrow();
});
