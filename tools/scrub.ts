import { BasicIssueSchema } from "../backend/models/gh/issue.ts";
import { PullRequestSchema } from "../backend/models/gh/pullRequest.ts";
import { z } from "zod";

const stripUnnecessaryFields = <T>(data: any, schema: z.ZodSchema<T>): T => {
  return schema.parse(data);
};

const cleanGitHubData = (data: any) => {
  const result: Record<string, any[]> = {};

  for (const [key, items] of Object.entries(data)) {
    const itemArray = items as any[];
    result[key] = itemArray.map((item: any) => {
      const { endpoint, response, status } = item;
      let cleanedResponse = response;

      // Add more endpoints here if needed. Commit doesnt work bc of the transformations, would need to think how to do it
      if (endpoint.includes("/issues/")) {
        // @ts-ignore: cant figure this out
        cleanedResponse = stripUnnecessaryFields(response, BasicIssueSchema);
      } else if (endpoint.match(/\/pulls\/\d+$/)) {
        // @ts-ignore: cant figure this out
        cleanedResponse = stripUnnecessaryFields(response, PullRequestSchema);
      }

      // ideally we would have a scrubbing mechanism:
      // - user name, user id, sha, dates, title, body

      return {
        endpoint,
        response: cleanedResponse,
        status,
      };
    });
  }

  return result;
};

// paste in sample from the debug endpoint here
const mockApiResponse = JSON.parse(`
`);

const cleanedData = cleanGitHubData(mockApiResponse);

console.log(JSON.stringify(cleanedData, null, 2));
