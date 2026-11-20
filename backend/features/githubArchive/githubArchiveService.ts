import { createHash } from "node:crypto";
import { glob, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { writeGithubArchive } from "./githubArchiveWriter.ts";
import {
  type GithubArchiveConfig,
  readGithubArchiveConfig,
  logGithubArchiveConfig,
} from "./githubArchiveConfig.ts";
import {
  GithubArchiveError,
  type GithubArchive,
  type GithubArchiveSnapshot,
} from "./githubArchiveTypes.ts";
import {
  createGithubArchiveUploader,
  type GithubArchiveUpload,
} from "./githubArchiveUploader.ts";

/** Read environment only when a sync is constructed, not for unrelated commands. */
export function githubArchiveFromEnv(repository: {
  owner: string;
  name: string;
}): GithubArchive | undefined {
  const config = readGithubArchiveConfig(process.env);
  logGithubArchiveConfig(config);
  return createGithubArchive(repository, config);
}

let lastCaptureTimestamp = 0;

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** One compressed file per successfully persisted issue/PR. No run-sized buffer. */
export function createGithubArchive(
  repository: { owner: string; name: string },
  config: GithubArchiveConfig,
  upload?: GithubArchiveUpload,
): GithubArchive | undefined {
  if (!config.local && !config.s3) return undefined;
  for (const segment of [repository.owner, repository.name]) {
    if (
      !/^[a-zA-Z0-9_.-]+$/.test(segment) ||
      segment === "." ||
      segment === ".."
    ) {
      throw new Error("Invalid archive repository path");
    }
  }
  const repoPath = join(repository.owner, repository.name);
  const localRoot = join(config.directory, config.prefix);
  // Isolate pending captures by destination. A config change must not send old
  // private payloads to a different bucket/endpoint. No credentials in this hash.
  const destination = createHash("sha256")
    .update(
      JSON.stringify([
        config.endpoint ?? "aws",
        config.region,
        config.bucket,
        config.prefix,
      ]),
    )
    .digest("hex")
    .slice(0, 16);
  const pendingRoot = join(config.directory, ".pending", destination);
  async function deliver(
    file: string,
    send: GithubArchiveUpload,
  ): Promise<boolean> {
    let uploaded = false;
    const capturePath = relative(pendingRoot, file);
    const key = [config.prefix, capturePath.split(sep).join("/")]
      .filter(Boolean)
      .join("/");
    try {
      await send(file, key);
      uploaded = true;
      if (config.local) {
        const retained = join(localRoot, capturePath);
        await mkdir(dirname(retained), { recursive: true, mode: 0o700 });
        await rename(file, retained);
      } else {
        await rm(file, { force: true });
      }
      return true;
    } catch (error) {
      // Two overlapping syncs may retry the same immutable capture. Uploads use
      // the same key; another successful delivery may already have moved it.
      if (isMissing(error)) {
        const sourceMissing = await stat(file).then(() => false, isMissing);
        if (sourceMissing) return uploaded;
      }
      throw new GithubArchiveError(
        `GitHub archive delivery failed; capture retained at ${file}`,
        { cause: error },
      );
    }
  }

  return {
    async uploadPending() {
      if (!config.s3) return 0;
      const batch = upload ? undefined : createGithubArchiveUploader(config);
      const send = upload ?? batch!.upload;
      let uploaded = 0;
      const root = join(pendingRoot, repoPath);
      try {
        // Only finalized captures; interrupted .partial files are never uploaded.
        for await (const file of glob("*/*.json.zst", { cwd: root })) {
          if (await deliver(join(root, file), send)) uploaded++;
        }
      } catch (error) {
        if (isMissing(error)) return uploaded;
        if (error instanceof GithubArchiveError) throw error;
        throw new GithubArchiveError(
          "Unable to upload pending GitHub archives",
          { cause: error },
        );
      } finally {
        batch?.close();
      }
      return uploaded;
    },
    async save(snapshot: GithubArchiveSnapshot) {
      if (!Number.isSafeInteger(snapshot.number) || snapshot.number < 1) {
        throw new GithubArchiveError("Invalid archive issue number");
      }
      // Keep same-process captures distinct even within one clock millisecond.
      lastCaptureTimestamp = Math.max(Date.now(), lastCaptureTimestamp + 1);
      const capturedAt = new Date(lastCaptureTimestamp).toISOString();
      const captureId = capturedAt
        .replaceAll("-", "_")
        .replace("T", "_")
        .replaceAll(":", "")
        .replace(".", "_");
      const capturePath = join(
        repoPath,
        String(snapshot.number),
        `${captureId}.json.zst`,
      );
      const file = join(config.s3 ? pendingRoot : localRoot, capturePath);
      try {
        await writeGithubArchive(
          file,
          {
            version: 1,
            captureId,
            capturedAt,
            repository,
            ...snapshot,
          },
          config.level,
        );
      } catch (error) {
        throw new GithubArchiveError(`Unable to write GitHub archive ${file}`, {
          cause: error,
        });
      }
    },
  };
}
