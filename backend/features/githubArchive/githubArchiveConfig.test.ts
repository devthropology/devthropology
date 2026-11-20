import { expect, test } from "vitest";
import { readGithubArchiveConfig } from "./githubArchiveConfig.ts";

test("disabled by default; local and S3 are independent", () => {
  expect(readGithubArchiveConfig({})).toMatchObject({
    local: false,
    s3: false,
    level: 6,
  });
  for (const local of ["true", "false"]) {
    for (const s3 of ["true", "false"]) {
      expect(
        readGithubArchiveConfig({
          GH_ARCHIVE_LOCAL: local,
          GH_ARCHIVE_S3: s3,
          GH_ARCHIVE_S3_BUCKET: "bucket",
        }),
      ).toMatchObject({ local: local === "true", s3: s3 === "true" });
    }
  }
});

test("prefix can be local/ without a format-version path segment", () => {
  expect(readGithubArchiveConfig({ GH_ARCHIVE_PREFIX: "local/" }).prefix).toBe(
    "local",
  );
  expect(readGithubArchiveConfig({}).prefix).toBe("gh_api_archive");
});

test("paths are repo-root relative and unused S3 configuration is ignored", () => {
  const c = readGithubArchiveConfig({
    GH_ARCHIVE_DIR: "./data",
    GH_ARCHIVE_S3_ENDPOINT: "not-a-url",
  });
  expect(c.directory).toBe(new URL("../../../data", import.meta.url).pathname);
  expect(c.endpoint).toBeUndefined();
});

test("R2 endpoint, auto region and blank optional env entries", () => {
  expect(
    readGithubArchiveConfig({
      GH_ARCHIVE_S3: "true",
      GH_ARCHIVE_S3_BUCKET: "bucket",
      GH_ARCHIVE_S3_ENDPOINT: "https://account.r2.cloudflarestorage.com",
      GH_ARCHIVE_S3_REGION: "",
    }),
  ).toMatchObject({ region: "auto" });
  expect(
    readGithubArchiveConfig({
      GH_ARCHIVE_S3_ENDPOINT: "",
      GH_ARCHIVE_LEVEL: "",
    }).level,
  ).toBe(6);
});

test.each([
  { GH_ARCHIVE_S3: "true" },
  { GH_ARCHIVE_LOCAL: "yes" },
  { GH_ARCHIVE_LEVEL: "abc" },
  { GH_ARCHIVE_LEVEL: "0" },
  { GH_ARCHIVE_LEVEL: "20" },
  { GH_ARCHIVE_PREFIX: "../escape" },
  { GH_ARCHIVE_PREFIX: "root/../escape" },
  { GH_ARCHIVE_PREFIX: "/absolute" },
  {
    GH_ARCHIVE_S3: "true",
    GH_ARCHIVE_S3_BUCKET: "bucket",
    GH_ARCHIVE_S3_ENDPOINT: "http://example.com",
  },
  {
    GH_ARCHIVE_S3: "true",
    GH_ARCHIVE_S3_BUCKET: "bucket",
    GH_ARCHIVE_S3_ENDPOINT: "https://user:password@example.com",
  },
])("rejects invalid configuration: %j", (env) => {
  expect(() => readGithubArchiveConfig(env)).toThrow();
});
