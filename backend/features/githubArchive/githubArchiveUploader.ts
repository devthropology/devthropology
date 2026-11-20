import { open } from "node:fs/promises";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { GithubArchiveConfig } from "./githubArchiveConfig.ts";

export type GithubArchiveUpload = (file: string, key: string) => Promise<void>;

/** One client/connection pool per upload batch, closed by the caller. */
export function createGithubArchiveUploader(config: GithubArchiveConfig) {
  // Credentials come from the standard AWS SDK chain, never from archive files.
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    maxAttempts: 3,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    requestHandler: { connectionTimeout: 10_000, requestTimeout: 120_000 },
  });
  return {
    close: () => client.destroy(),
    async upload(file: string, key: string): Promise<void> {
      await using handle = await open(file, "r");
      const { size } = await handle.stat();
      const body = handle.createReadStream({ autoClose: false });
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: key,
            Body: body,
            ContentLength: size,
            ContentType: "application/zstd",
          }),
        );
      } finally {
        body.destroy();
      }
    },
  };
}
