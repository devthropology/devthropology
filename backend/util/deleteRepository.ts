import process, { env } from "node:process";
import { loadEnv } from "./loadEnv.ts";
import postgres from "postgres";

// Run from the repo root. No database writes unless --wet-run is supplied.
// Stop all sync/backfill workers before deletion: removing configuration does
// not cancel work already loaded by a worker. Batches commit independently;
// rerun after a failure to finish. Deletion creates WAL, so allow disk headroom.
const BATCH_SIZE = 10_000;
const PR_CHILDREN = [
  "computed_pull_request_metrics",
  "pull_request_comment",
  "pull_request_commit",
  "pull_request_enhanced_stats",
  "pull_request_file",
  "pull_request_review",
  "pull_request_round_of_review",
];
const ISSUE_CHILDREN = ["issue_comment", "issue_backfill"];
const REPO_TABLES = [
  "computed_filesystem",
  "computed_repository_contributors",
  "computed_repository_overview",
  "computed_trends_monthly",
  "computed_trends_monthly_ai_model",
  "computed_trends_monthly_size_bucket",
  "computed_user_metrics",
  "computed_user_relationship",
  "user_activity",
  "sync_jobs",
  "workspace_repository",
];

export function parseDeleteArgs(args: string[]) {
  const positional = args.filter((arg) => arg !== "--wet-run");
  if (
    positional.length !== 1 ||
    !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(positional[0]) ||
    args.filter((arg) => arg === "--wet-run").length > 1
  ) {
    throw new Error(
      "Usage: node --import tsx util/deleteRepository.ts org/repo [--wet-run]",
    );
  }
  const [org, repo] = positional[0].split("/");
  return { org, repo, wetRun: args.includes("--wet-run") };
}

export function repositoryDeletionScopes() {
  const issues = "SELECT issue_id FROM public.issue WHERE repository_id = $1";
  const pulls = `SELECT pull_request_id FROM public.pull_request WHERE issue_id IN (${issues})`;
  const cron =
    "SELECT sync_cron_repository_id FROM public.sync_cron_repositories WHERE repository_id = $1";
  return [
    ...PR_CHILDREN.map((table) => ({
      table,
      where: `pull_request_id IN (${pulls})`,
    })),
    { table: "pull_request", where: `issue_id IN (${issues})` },
    ...ISSUE_CHILDREN.map((table) => ({
      table,
      where: `issue_id IN (${issues})`,
    })),
    { table: "issue", where: "repository_id = $1" },
    ...REPO_TABLES.map((table) => ({ table, where: "repository_id = $1" })),
    { table: "sync_cron_runs", where: `sync_cron_repository_id IN (${cron})` },
    {
      table: "sync_cron_repository_api_keys",
      where: `sync_cron_repository_id IN (${cron})`,
    },
    { table: "sync_cron_repositories", where: "repository_id = $1" },
    { table: "sync_repositories", where: "repository_id = $1" },
    {
      table: "team_members",
      where:
        "team_id IN (SELECT team_id FROM public.teams WHERE repository_id = $1)",
    },
    { table: "teams", where: "repository_id = $1" },
    { table: "repository", where: "repository_id = $1" },
  ];
}

const mib = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(2)} MiB`;

export async function main(args: string[]) {
  const { org, repo, wetRun } = parseDeleteArgs(args);
  await loadEnv();
  const url = env.DATABASE_URL_PG_REMOTE;
  if (!url) {
    throw new Error("DATABASE_URL_PG_REMOTE is required (env or .env).");
  }
  const target = new URL(url);
  console.log(
    `${wetRun ? "WET RUN" : "DRY RUN"}: ${org}/${repo} on ${target.hostname}:${
      target.port || "5432"
    }${target.pathname}`,
  );
  const sql = postgres(url, {
    max: 1,
    connect_timeout: 10,
    connection: {
      application_name: "deleteRepository",
      default_transaction_read_only: !wetRun,
      statement_timeout: 120000,
      lock_timeout: 5000,
      // Fail instead of spilling queries onto an almost-full volume.
      temp_file_limit: "0",
      work_mem: "32MB",
      max_parallel_workers_per_gather: "0",
    },
  });
  const printDatabaseSize = async (label: string) => {
    const [row] = await sql`
      SELECT current_database() AS name,
        pg_database_size(current_database())::text AS bytes
    `;
    const bytes = Number(row.bytes);
    console.log(
      `${label} database size (${row.name}): ${mib(bytes)} / ${(
        bytes / 1e9
      ).toFixed(3)} GB (${bytes.toLocaleString(
        "en-US",
      )} bytes). Excludes WAL and other volume usage.`,
    );
  };
  let deletionStarted = false;
  try {
    // Print before lookup so a post-deletion dry-run still reports DB size.
    await printDatabaseSize("Current");
    const repos = await sql`
      SELECT repository_id::text AS id, org, name FROM public.repository
      WHERE lower(org) = lower(${org}) AND lower(name) = lower(${repo})
    `;
    if (repos.length === 0) {
      console.log(`Repository ${org}/${repo} not found; nothing to delete.`);
      return;
    }
    if (repos.length !== 1) {
      throw new Error(`Expected one repository, found ${repos.length}.`);
    }
    const { id } = repos[0];
    console.log(`Repository ID: ${id}`);
    let total = 0;
    let totalRows = 0;
    let unknown = 0;
    const stats = [];
    for (const { table, where } of repositoryDeletionScopes()) {
      // Identifiers and predicates come exclusively from the fixed plan above.
      const [row] = await sql.unsafe(
        `
        SELECT count(*)::text AS rows,
          (SELECT reltuples FROM pg_class WHERE oid = 'public.${table}'::regclass) AS estimated_total_rows,
          pg_total_relation_size('public.${table}'::regclass)::text AS table_bytes
        FROM public.${table} WHERE ${where}
      `,
        [id],
      );
      const count = Number(row.rows);
      totalRows += count;
      const estimatedRows = Number(row.estimated_total_rows);
      const bytes =
        count === 0
          ? 0
          : estimatedRows > 0
            ? Number(row.table_bytes) * Math.min(1, count / estimatedRows)
            : null;
      if (bytes === null) unknown++;
      else total += bytes;
      stats.push({
        table,
        rows: count,
        "estimated data + indexes":
          bytes === null ? "unknown (missing statistics)" : mib(bytes),
      });
    }
    stats.push({
      table: "TOTAL",
      rows: totalRows,
      "estimated data + indexes": `${mib(total)}${
        unknown ? ` + ${unknown} unestimated tables` : ""
      }`,
    });
    console.table(stats);
    console.log(
      `Approximate footprint: ${mib(total)}${
        unknown ? ` + ${unknown} unestimated tables` : ""
      }.`,
    );
    console.log(
      "Uses row share × table size (planner estimates); variable row sizes/bloat can skew this substantially. Shared users/profiles/API keys excluded.",
    );
    console.log(
      "DELETE usually does NOT shrink disk files; it generates WAL and needs free space. No vacuum/compaction is performed.",
    );
    if (!wetRun) return;
    if (
      !confirm(
        "Backup verified, sufficient disk headroom, and ALL sync/backfill workers stopped? Delete this repository and ALL its data?",
      )
    ) {
      console.log("Cancelled; nothing changed.");
      return;
    }
    deletionStarted = true;
    await sql.begin(async (tx) => {
      // Cron associations and run history cascade from this configuration.
      console.log(
        "[sync] Deleting sync_cron_repositories (cascades to cron runs and key associations)...",
      );
      const cron =
        await tx`DELETE FROM public.sync_cron_repositories WHERE repository_id = ${id}`;
      console.log(`[sync] ${cron.count} config rows deleted (pending commit).`);
      console.log("[sync] Deleting sync_repositories...");
      const legacy =
        await tx`DELETE FROM public.sync_repositories WHERE repository_id = ${id}`;
      console.log(
        `[sync] ${legacy.count} config rows deleted (pending commit).`,
      );
    });
    console.log(
      "Removed both sync configurations (and cascading cron history/key associations).",
    );

    for (const kind of ["pull_request", "issue"] as const) {
      let deleted = 0;
      let chunk = 0;
      const plannedRows = stats.find((row) => row.table === kind)!.rows;
      console.log(
        `[${kind}] Starting: ${plannedRows} rows at preview; up to ${BATCH_SIZE} parents per chunk (children may exceed this).`,
      );
      while (true) {
        const label = `[${kind} chunk ${chunk + 1}]`;
        console.log(`${label} Selecting up to ${BATCH_SIZE} parent rows...`);
        const count = await sql.begin(async (tx) => {
          const batch =
            kind === "pull_request"
              ? await tx`SELECT p.pull_request_id::text AS id FROM public.pull_request p
                JOIN public.issue i ON i.issue_id = p.issue_id
                WHERE i.repository_id = ${id} ORDER BY p.pull_request_id
                LIMIT ${BATCH_SIZE} FOR UPDATE OF p`
              : await tx`SELECT issue_id::text AS id FROM public.issue
                WHERE repository_id = ${id} ORDER BY issue_id
                LIMIT ${BATCH_SIZE} FOR UPDATE`;
          if (!batch.length) return 0;
          const ids = batch.map((row) => row.id);
          console.log(
            `${label} Processing ${batch.length} parents, IDs ${ids[0]}–${ids.at(
              -1,
            )}.`,
          );
          const key = kind === "pull_request" ? "pull_request_id" : "issue_id";
          const children =
            kind === "pull_request" ? PR_CHILDREN : ISSUE_CHILDREN;
          for (const table of [...children, kind]) {
            console.log(`${label} Deleting from ${table}...`);
            const result = await tx`DELETE FROM ${tx(
              `public.${table}`,
            )} WHERE ${tx(key)} IN ${tx(ids)}`;
            console.log(
              `${label} ${table}: ${result.count} rows deleted (pending commit).`,
            );
          }
          return batch.length;
        });
        if (!count) break;
        deleted += count;
        chunk++;
        console.log(
          `${label} COMMITTED: ${count} parents + children; ${deleted}/${plannedRows} preview parent rows processed.`,
        );
      }
      console.log(
        `[${kind}] Complete: ${deleted} parents deleted in ${chunk} chunks.`,
      );
    }
    // Remaining repo-scoped rows are also bounded to 10k per transaction.
    const remaining = repositoryDeletionScopes().filter(
      ({ table }) =>
        REPO_TABLES.includes(table) ||
        table === "team_members" ||
        table === "teams",
    );
    for (const { table, where } of remaining) {
      let deleted = 0;
      let chunk = 0;
      const plannedRows = stats.find((row) => row.table === table)!.rows;
      console.log(
        `[${table}] Starting cleanup: ${plannedRows} rows at preview.`,
      );
      while (true) {
        console.log(
          `[${table} chunk ${chunk + 1}] Deleting up to ${BATCH_SIZE} rows...`,
        );
        const result = await sql.unsafe(
          `DELETE FROM public.${table}
          WHERE ctid IN (SELECT ctid FROM public.${table} WHERE ${where} LIMIT ${BATCH_SIZE})`,
          [id],
        );
        deleted += result.count;
        if (result.count === 0) break;
        chunk++;
        console.log(
          `[${table} chunk ${chunk}] COMMITTED: ${result.count} rows; ${deleted}/${plannedRows} preview rows processed.`,
        );
      }
      console.log(
        `[${table}] Complete: ${deleted} rows deleted in ${chunk} chunks.`,
      );
    }
    await sql.begin(async (tx) => {
      for (const { table, where } of repositoryDeletionScopes()) {
        if (table === "repository") continue;
        console.log(
          `[verify] Checking ${table} for remaining repository data...`,
        );
        const rows = await tx.unsafe(
          `SELECT 1 FROM public.${table} WHERE ${where} LIMIT 1`,
          [id],
        );
        if (rows.length) {
          throw new Error(`Remaining data in ${table}; repository retained.`);
        }
      }
      console.log(`[repository] Deleting repository ${id} (pending commit)...`);
      await tx`DELETE FROM public.repository WHERE repository_id = ${id}`;
    });
    console.log(
      `Deleted ${org}/${repo}. Shared entities preserved. No vacuum performed.`,
    );
    await printDatabaseSize("After deletion");
  } catch (error) {
    if (deletionStarted) {
      console.error(
        "Earlier batches may have committed. Keep workers stopped; fix the error and rerun to finish.",
      );
    }
    throw error;
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Deletion CLI failed.",
    );
    process.exitCode = 1;
  }
}
