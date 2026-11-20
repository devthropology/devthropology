import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { zstdDecompressSync } from "node:zlib";
import { afterEach, expect, test, vi } from "vitest";
import { getCleanTestDatabase } from "../../testUtils/testDatabase.ts";
import { loadTestData } from "../../test/loadTestData.ts";
import { createSqlClient } from "../../repository/sqlClient.ts";
import { PostgresRepository } from "../../repository/postgresRepository.ts";
import { PostgresComputedUserMetricsRepository } from "../../repository/postgresComputedUserMetricsRepository.ts";
import { TrendsRepository } from "../trends/trendsRepository.ts";
import { GhApi } from "../../api/ghApi.ts";
import { Backfiller } from "../../backfill/backfiller.ts";
import { readGithubArchiveConfig } from "./githubArchiveConfig.ts";
import { createGithubArchive } from "./githubArchiveService.ts";

afterEach(() => vi.unstubAllEnvs());

test("GitHub fixture → Postgres → R2 rejection → restart and retry", async () => {
  const sql = createSqlClient(await getCleanTestDatabase());
  const directory = await mkdtemp(
    join(tmpdir(), "github-archive-integration-"),
  );
  const originalFetch = globalThis.fetch;
  const repository = { owner: "org", name: "repo" };
  const uploads: Array<{ key: string; body: Buffer }> = [];
  const handlerErrors: unknown[] = [];
  let rejectUpload = true;
  const captures = async () =>
    (await readdir(directory, { recursive: true })).filter((f) =>
      f.endsWith(".json.zst"),
    );
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      uploads.push({ key: request.url!, body: Buffer.concat(chunks) });
      if (uploads.length === 1) {
        // The externally visible boundary: data is committed and staged before PUT.
        const rows =
          await sql`SELECT i.gh_issue_id, i.state, p.pull_request_id FROM issue i JOIN pull_request p USING(issue_id) JOIN repository r USING(repository_id) WHERE r.org='org' AND r.name='repo'`;
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ gh_issue_id: 1, state: "closed" });
        expect(rows[0].pull_request_id).not.toBeNull();
        const files = await captures();
        expect(files).toHaveLength(1);
        expect(files[0]).toMatch(/^\.pending\//);
        expect(await readFile(join(directory, files[0]))).toEqual(
          uploads[0].body,
        );
      }
    } catch (error) {
      handlerErrors.push(error);
    } finally {
      // Complete even on assertion failure; surface the original error in the test.
      const denied = rejectUpload || handlerErrors.length > 0;
      response.writeHead(denied ? 403 : 200, {
        "content-type": "application/xml",
      });
      response.end(denied ? "<Error><Code>AccessDenied</Code></Error>" : "");
    }
  });
  try {
    vi.stubEnv("AWS_ACCESS_KEY_ID", "test-key");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "test-secret");
    vi.stubEnv("AWS_SESSION_TOKEN", "");
    vi.stubEnv("AWS_PROFILE", "");
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Expected TCP address");
    const config = {
      ...readGithubArchiveConfig({
        GH_ARCHIVE_LOCAL: "true",
        GH_ARCHIVE_DIR: directory,
      }),
      s3: true,
      bucket: "test-bucket",
      region: "us-east-1",
      endpoint: `http://127.0.0.1:${address.port}`, // Loopback only; runtime config requires HTTPS.
    };
    await loadTestData("backend/test/data/madeup.jsonl", "org", "repo", 1);
    const buildBackfiller = () =>
      new Backfiller(
        new GhApi("org", "repo", "test", "test-token"),
        new PostgresRepository("org", "repo", sql),
        {
          archive: createGithubArchive(repository, config),
          silent: true,
          computedUserMetricsRepository:
            new PostgresComputedUserMetricsRepository(sql),
          trendsRepository: new TrendsRepository(sql),
        },
      );
    // Capture the outcome so handler assertions cannot be masked as expected denial.
    const failure = await buildBackfiller()
      .backfillFromLatest(1)
      .then(
        () => undefined,
        (error) => error,
      );
    if (handlerErrors.length) throw handlerErrors[0];
    expect(failure).toMatchObject({
      message: expect.stringContaining("capture retained"),
    });
    expect(uploads).toHaveLength(1);
    const [pending] = await captures();
    const partial = join(directory, `${pending}.interrupted.partial`);
    await writeFile(partial, "unfinished capture");

    rejectUpload = false;
    // Fresh archive, API and repository instances: only disk/DB state survives.
    await buildBackfiller().backfillFromLatest(1);
    if (handlerErrors.length) throw handlerErrors[0];
    expect(uploads).toHaveLength(2);
    expect(uploads[0].key).toBe(uploads[1].key);
    const files = await captures();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^gh_api_archive\/org\/repo\/1\//);
    const bytes = await readFile(join(directory, files[0]));
    expect(uploads[0].body).toEqual(bytes);
    expect(uploads[1].body).toEqual(bytes);
    expect(JSON.parse(zstdDecompressSync(bytes).toString())).toMatchObject({
      version: 1,
      repository,
      number: 1,
      type: "pull_request",
    });
    expect(await readFile(partial, "utf8")).toBe("unfinished capture");
  } finally {
    globalThis.fetch = originalFetch;
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    await sql.end({ timeout: 1 });
    await rm(directory, { recursive: true, force: true });
  }
});
