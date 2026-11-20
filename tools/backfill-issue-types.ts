// node --import tsx tools/backfill-issue-types.ts <org> <repo> [databaseUrl]

import process, { env } from "node:process";
import { GhApi } from "../backend/api/ghApi.ts";
import { IssueType } from "../backend/models/gh/issueType.ts";
import { createSqlClient } from "../backend/repository/sqlClient.ts";

if (process.argv.length < 4) {
  console.error("Usage: backfill-issue-types <org> <repo> [databaseUrl]");
  process.exit(1);
}

const org = process.argv[2];
const repo = process.argv[3];
const databaseUrl = process.argv[4] ?? env.DATABASE_URL_PG;
const token = env.GH_TOKEN;

if (!token) {
  console.error("GH_TOKEN environment variable is required");
  process.exit(1);
}

if (!databaseUrl) {
  console.error(
    "DATABASE_URL_PG must be provided via argument or environment variable",
  );
  process.exit(1);
}

const ghApi = new GhApi(org, repo, "dpclark4", token);
const sql = createSqlClient(databaseUrl);

type CountRow = { count: number | string };

function parseCount(row: CountRow | undefined): number {
  if (!row) return 0;
  const value =
    typeof row.count === "string" ? Number.parseInt(row.count, 10) : row.count;
  return Number.isFinite(value) ? value : 0;
}

async function updateIssueType(
  ghIssueId: number,
  issueTypeId: IssueType,
  repositoryId: number,
): Promise<void> {
  await sql`
    UPDATE issue 
    SET issue_type_id = ${issueTypeId} 
    WHERE gh_issue_id = ${ghIssueId}
    AND repository_id = ${repositoryId}
  `;
}

async function processIssue(
  ghIssueId: number,
  repositoryId: number,
): Promise<{ gh_issue_id: number; issueTypeId: IssueType }> {
  let issueTypeId = IssueType.UNKNOWN;

  const pullRequestResult = await sql<{ gh_issue_id: number }[]>`
    SELECT i.gh_issue_id
    FROM issue i
    INNER JOIN pull_request pr ON pr.issue_id = i.issue_id
    WHERE i.gh_issue_id = ${ghIssueId}
    AND i.repository_id = ${repositoryId}
  `;
  if (pullRequestResult.length > 0) {
    issueTypeId = IssueType.PULL_REQUEST;
    await updateIssueType(ghIssueId, issueTypeId, repositoryId);
    console.log(
      `Found ${ghIssueId} in pull_request table, marked as pull request`,
    );
    return { gh_issue_id: ghIssueId, issueTypeId };
  }

  try {
    const issue = await ghApi.getIssue(ghIssueId);
    issueTypeId = issue.pull_request ? IssueType.PULL_REQUEST : IssueType.ISSUE;
    if (!issue.pull_request) {
      console.log(`Found ${ghIssueId} in issue table, marked as issue`);
    }
    await updateIssueType(ghIssueId, issueTypeId, repositoryId);
  } catch (error) {
    if (error instanceof Error) {
      const errorMessage = error.message.toLowerCase();

      if (errorMessage.includes("moved")) {
        issueTypeId = IssueType.MOVED;
      } else if (errorMessage.includes("not found")) {
        issueTypeId = IssueType.NOT_FOUND;
      } else if (errorMessage.includes("deleted")) {
        issueTypeId = IssueType.DELETED;
      } else if (errorMessage.includes("rate limit")) {
        console.warn(`Rate limit hit for issue ${ghIssueId}`);
        return { gh_issue_id: ghIssueId, issueTypeId };
      } else {
        console.error(`Error processing issue ${ghIssueId}:`, error);
        return { gh_issue_id: ghIssueId, issueTypeId };
      }
      await updateIssueType(ghIssueId, issueTypeId, repositoryId);
    } else {
      console.error(`Unexpected error processing issue ${ghIssueId}:`, error);
    }
  }
  console.log(`Processed ${ghIssueId} with type ${issueTypeId}`);
  return { gh_issue_id: ghIssueId, issueTypeId };
}

async function backfillIssueTypes() {
  console.log("Starting issue type backfill...");

  const repoRows = await sql<{ repository_id: number }[]>`
    SELECT repository_id 
    FROM repository 
    WHERE org = ${org} AND name = ${repo}
  `;
  const repoId = repoRows[0]?.repository_id;

  if (!repoId) {
    console.error(`Repository ${org}/${repo} not found`);
    return;
  }

  const unknownCountRow = await sql<CountRow[]>`
    SELECT COUNT(*) as count
    FROM issue 
    WHERE issue_type_id = ${IssueType.UNKNOWN}
    AND repository_id = ${repoId}
  `;
  console.log(
    `Found ${parseCount(unknownCountRow[0])} issues with unknown type at start`,
  );

  const bulkUpdatePullRequests = await sql`
    UPDATE issue 
    SET issue_type_id = ${IssueType.PULL_REQUEST}
    WHERE issue_id IN (
      SELECT i.issue_id
      FROM issue i
      INNER JOIN pull_request pr ON pr.issue_id = i.issue_id
      WHERE i.issue_type_id = ${IssueType.UNKNOWN}
      AND i.repository_id = ${repoId}
    )
  `;
  console.log(
    `Updated ${
      bulkUpdatePullRequests.count ?? 0
    } issues to pull request type based on pull_request table`,
  );

  const unknownIssues = await sql<{ gh_issue_id: number }[]>`
    SELECT gh_issue_id 
    FROM issue 
    WHERE issue_type_id = ${IssueType.UNKNOWN}
    AND repository_id = ${repoId}
  `;

  const total = unknownIssues.length;
  console.log(`Found ${total} issues to process`);

  let processed = 0;
  const batchSize = 10;

  for (let i = 0; i < unknownIssues.length; i += batchSize) {
    const batch = unknownIssues.slice(i, i + batchSize);
    const promises = batch.map(({ gh_issue_id }) =>
      processIssue(gh_issue_id, repoId),
    );

    await Promise.all(promises);
    processed += batch.length;
    console.log(`Processed ${processed}/${total} issues`);
  }

  console.log(`\nBackfill complete! Processed ${processed} issues.`);

  const finalStats = await sql<
    { issue_type_id: number; count: string | number }[]
  >`
    SELECT issue_type_id, COUNT(*) as count 
    FROM issue 
    WHERE repository_id = ${repoId}
    GROUP BY issue_type_id
  `;

  console.log("\nFinal issue type distribution:");
  for (const { issue_type_id, count } of finalStats) {
    const safeCount =
      typeof count === "string" ? Number.parseInt(count, 10) : count;
    console.log(`Type ${issue_type_id}: ${safeCount} issues`);
  }
}

try {
  await backfillIssueTypes();
} catch (error) {
  console.error("Error during backfill:", error);
} finally {
  await sql.end({ timeout: 1 });
}
