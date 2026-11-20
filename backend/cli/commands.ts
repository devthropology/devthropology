import { Command } from "commander";
import { env } from "node:process";

export interface BackfillOptions {
  repo: string;
  username: string;
  databaseUrl?: string;
  ghToken: string;
  all?: boolean;
  allLastSeen?: boolean;
}
export interface CreateUserOptions {
  username: string;
  password: string;
  role: string;
  printToken?: boolean;
}
export interface EnhancedStatsOptions {
  repo?: string;
  allRepositories?: boolean;
  databaseUrl?: string;
}
export interface CliActions {
  backfill: (options: BackfillOptions, users: string[]) => Promise<void>;
  createUser: (options: CreateUserOptions) => Promise<void>;
  enhancedStats: (options: EnhancedStatsOptions) => Promise<void>;
  syncCron: (options: { databaseUrl?: string }) => Promise<void>;
}

/** Normalize Cliffy's multi-character short alias without rewriting values. */
export function normalizeCliArgs(args: string[]): string[] {
  const valueFlags = new Set([
    "-r",
    "--repo",
    "-u",
    "--username",
    "-d",
    "--databaseUrl",
    "-p",
    "--password",
    "--role",
  ]);
  let literal = false;
  let value = false;
  return args.map((arg) => {
    if (literal) return arg;
    if (value) {
      value = false;
      return arg;
    }
    if (arg === "--") literal = true;
    value = valueFlags.has(arg);
    return arg === "-als" ? "--allLastSeen" : arg;
  });
}

/** Parsing is separate from database/GitHub actions so CLI contracts are testable. */
export function createCli(actions: CliActions): Command {
  const root = new Command("gh-track").version("0.0.1");
  root
    .command("backfill")
    .description("Backfill pull request data from GitHub")
    .hook("preAction", (command) => {
      if (env.GH_TOKEN === undefined) command.error("GH_TOKEN is required");
      command.setOptionValue("ghToken", env.GH_TOKEN);
    })
    .addHelpText(
      "after",
      "\nEnvironment:\n  GH_TOKEN  GitHub API token (required)",
    )
    .requiredOption("-r, --repo <repo>", "Repository name including org")
    .requiredOption("-u, --username <username>", "YOUR username")
    .option(
      "-d, --databaseUrl <url>",
      "PostgreSQL connection string (defaults to env DATABASE_URL_PG)",
    )
    .option("-a, --all", "backfill data for all users")
    .option("--allLastSeen", "backfill from last seen (also accepts -als)")
    .argument("[users...]")
    .action((users: string[], options: BackfillOptions) =>
      actions.backfill(options, users),
    );

  root
    .command("auth")
    .description("Authentication helpers")
    .command("create-user")
    .description("Create a local auth user")
    .requiredOption("-u, --username <username>", "Username to create")
    .requiredOption("-p, --password <password>", "Password for the user")
    .option("-r, --role <role>", "Role for the user", "admin")
    .option(
      "--print-token",
      "Print bearer token after creation (local/dev use only)",
    )
    .action((options: CreateUserOptions) => actions.createUser(options));

  root
    .command("backfill-enhanced-pr-stats")
    .description("Backfill enhanced PR stats from stored PostgreSQL data")
    .option("-r, --repo <repo>", "Repository name including org")
    .option(
      "--all-repositories",
      "Run sequentially for every repository in the database",
    )
    .option(
      "-d, --databaseUrl <url>",
      "PostgreSQL connection string (defaults to env DATABASE_URL_PG)",
    )
    .action((options: EnhancedStatsOptions, command: Command) => {
      if (!options.repo && !options.allRepositories) {
        command.error("Provide either --repo org/repo or --all-repositories");
      }
      if (options.repo && options.allRepositories) {
        command.error("Use either --repo or --all-repositories, not both");
      }
      return actions.enhancedStats(options);
    });

  root
    .command("sync-cron")
    .description("Run the repository sync cron using configured cron tables")
    .option(
      "-d, --databaseUrl <url>",
      "PostgreSQL connection string (defaults to env DATABASE_URL_PG)",
    )
    .action((options: { databaseUrl?: string }) => actions.syncCron(options));
  return root;
}
