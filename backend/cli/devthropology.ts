import process, { env } from "node:process";

type RelatedFilesResponse = {
  missing_paths?: string[];
  files?: Array<{ related_files: Array<{ path: string }> }>;
};

type SlimRelatedFilesResponse = {
  missing_paths: string[];
  files: RelatedFilesResponse["files"];
};

const REQUIRED_ENV_VARS = [
  "DEVTHROPOLOGY_API_URL",
  "DEVTHROPOLOGY_API_TOKEN",
  "DEVTHROPOLOGY_OWNER",
  "DEVTHROPOLOGY_REPO",
] as const;

const HELP = `Devthropology CLI

Usage:
  devthropology related-files <file...>

Required environment variables:
  DEVTHROPOLOGY_API_URL      API base URL, for example http://localhost:8002
  DEVTHROPOLOGY_API_TOKEN    Bearer token for the Devthropology API
  DEVTHROPOLOGY_OWNER        Repository owner or organization
  DEVTHROPOLOGY_REPO         Repository name

Optional environment variables:
  DEVTHROPOLOGY_RELATED_FILES_LIMIT   Max related files to return, default 8

Files must be repository-relative paths:
  devthropology related-files backend/main.ts backend/services/fileSystemService.ts
`;

export async function main() {
  const [command, ...rawArgs] = process.argv.slice(2);

  if (
    !command ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    console.log(HELP);
    return;
  }

  if (command !== "related-files") {
    fail(`Unknown command: ${command}\n\n${HELP}`);
  }

  const missingEnvVars = REQUIRED_ENV_VARS.filter((name) => !env[name]);
  if (missingEnvVars.length > 0) {
    fail(
      `Missing required environment variables: ${missingEnvVars.join(
        ", ",
      )}\n\n${HELP}`,
    );
  }

  const paths = rawArgs
    .flatMap((arg) => arg.split(","))
    .map((arg) => arg.trim())
    .filter(Boolean);

  if (paths.length === 0) {
    fail(`At least one file path is required.\n\n${HELP}`);
  }

  const apiUrl = env.DEVTHROPOLOGY_API_URL!.replace(/\/+$/, "");
  const token = env.DEVTHROPOLOGY_API_TOKEN!;
  const owner = encodeURIComponent(env.DEVTHROPOLOGY_OWNER!);
  const repo = encodeURIComponent(env.DEVTHROPOLOGY_REPO!);
  const limit = parseLimit(env.DEVTHROPOLOGY_RELATED_FILES_LIMIT);

  const response = await fetch(
    `${apiUrl}/api/agent-context/${owner}/${repo}/related-files`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ paths, limit }),
    },
  );

  const responseText = await response.text();
  if (!response.ok) {
    fail(`API request failed with ${response.status}: ${responseText}`);
  }

  const parsed = JSON.parse(responseText) as RelatedFilesResponse;
  const slimResponse: SlimRelatedFilesResponse = {
    missing_paths: parsed.missing_paths ?? [],
    files: parsed.files ?? [],
  };

  console.log(JSON.stringify(slimResponse, null, 2));
}

function parseLimit(rawLimit: string | undefined): number {
  if (!rawLimit) return 8;

  const parsed = Number(rawLimit);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
    fail("DEVTHROPOLOGY_RELATED_FILES_LIMIT must be an integer from 1 to 20");
  }

  return parsed;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (import.meta.main) {
  await main();
}
