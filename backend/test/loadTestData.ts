import { readFile } from "node:fs/promises";
import { z } from "zod";
import { type JsonValue, mockFetch, type MockUrls } from "./mock_fetch.ts";

export async function loadTestData(
  filePath: string,
  org: string,
  repo: string,
  number: number,
  overrides: MockUrls = {},
) {
  const lineSchema = z.record(
    z.string().transform((key: string) => Number(key)),
    z.array(
      z.object({
        endpoint: z.string(),
        response: z.unknown(),
        status: z.number(),
      }),
    ),
  );
  type ParsedLine = z.infer<typeof lineSchema>;
  type MockResponseData = {
    endpoint: string;
    response: unknown;
    status: number;
  };

  const mockUrls: MockUrls = {};
  const fileContent = await readFile(filePath, "utf8");
  const lines = fileContent.split("\n").filter(Boolean);

  lines.forEach((line) => {
    const parsed: ParsedLine = lineSchema.parse(JSON.parse(line));
    Object.values(parsed)
      .flat()
      .forEach((rawData) => {
        const data = rawData as MockResponseData;
        mockUrls[data.endpoint] = {
          // https://github.com/colinhacks/zod/discussions/2215
          body: data.response as JsonValue,
          status: data.status,
        };
      });
  });

  mockUrls["https://api.github.com/rate_limit"] = {
    body: {
      rate: {
        limit: 5000,
        used: 0,
        remaining: 5000,
        reset: Math.floor(Date.now() / 1000) + 90,
      },
    },
    status: 200,
  };
  mockUrls[
    `https://api.github.com/repos/${org}/${repo}/issues?per_page=1&page=1&direction=desc&state=all`
  ] = {
    body: [
      {
        number: number,
      },
    ],
    status: 200,
  };
  mockFetch({ ...mockUrls, ...overrides });
}
