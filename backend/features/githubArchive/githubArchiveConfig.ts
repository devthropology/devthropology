import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const flag = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");
const schema = z.object({
  GH_ARCHIVE_LOCAL: flag,
  GH_ARCHIVE_S3: flag,
  GH_ARCHIVE_DIR: z.string().min(1).default("./data"),
  GH_ARCHIVE_LEVEL: z.coerce.number().int().min(1).max(19).default(6),
  GH_ARCHIVE_PREFIX: z
    .string()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*(\/[a-zA-Z0-9][a-zA-Z0-9._-]*)*\/?$/)
    .transform((prefix) => prefix.replace(/\/$/, ""))
    .default("gh_api_archive"),
});
const s3Schema = z.object({
  GH_ARCHIVE_S3_BUCKET: z.string().min(1),
  GH_ARCHIVE_S3_REGION: z.string().default("auto"),
  GH_ARCHIVE_S3_ENDPOINT: z
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    }, "Expected HTTPS endpoint without credentials, query or fragment")
    .optional(),
});

export function readGithubArchiveConfig(env: NodeJS.ProcessEnv) {
  const values = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== ""),
  );
  const v = schema.parse(values);
  // An unused S3 setting must not prevent local-only archival.
  const s3 = v.GH_ARCHIVE_S3 ? s3Schema.safeParse(values) : undefined;
  if (s3 && !s3.success) {
    // Report setting names, not values which might contain credentials.
    throw new Error(
      `Invalid GitHub archive S3 settings: ${s3.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
  }
  return {
    local: v.GH_ARCHIVE_LOCAL,
    s3: v.GH_ARCHIVE_S3,
    directory: resolve(repositoryRoot, v.GH_ARCHIVE_DIR),
    level: v.GH_ARCHIVE_LEVEL,
    prefix: v.GH_ARCHIVE_PREFIX,
    bucket: s3?.data?.GH_ARCHIVE_S3_BUCKET,
    region: s3?.data?.GH_ARCHIVE_S3_REGION ?? "auto",
    endpoint: s3?.data?.GH_ARCHIVE_S3_ENDPOINT,
  };
}

export type GithubArchiveConfig = ReturnType<typeof readGithubArchiveConfig>;

export function logGithubArchiveConfig(config: GithubArchiveConfig): void {
  if (!config.local && !config.s3) return;
  console.info(
    `GitHub archive directory: ${config.directory}; keep local: ${config.local}; upload: ${config.s3 ? `s3://${config.bucket}/${config.prefix}/` : "disabled"}`,
  );
}
