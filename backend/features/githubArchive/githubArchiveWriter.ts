import { createWriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { link, mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { constants, createZstdCompress } from "node:zlib";

/** Publish a complete capture without replacing an existing file. */
export async function writeGithubArchive(
  file: string,
  record: unknown,
  level: number,
): Promise<void> {
  const json = JSON.stringify(record) + "\n";
  const compressor = createZstdCompress({
    params: { [constants.ZSTD_c_compressionLevel]: level },
  });
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const partial = `${file}.${randomUUID()}.partial`;
  const output = createWriteStream(partial, { flags: "wx", mode: 0o600 });
  try {
    await pipeline(Readable.from([json]), compressor, output);
    // Unlike rename(), link() refuses to overwrite a capture from another writer.
    // Both paths are on the same filesystem; readers only see the finished file.
    await link(partial, file);
  } finally {
    await rm(partial, { force: true });
  }
}
