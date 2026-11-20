import { fileURLToPath } from "node:url";
import { resolveBinary } from "dbmate";
import { resolveDatabaseUrlWithPassword } from "./sqlClient.ts";
import { runCommand } from "../util/runCommand.ts";

/** Applies pending dbmate migrations to the configured database. */
export async function runMigrations(): Promise<string> {
  const url = await resolveDatabaseUrlWithPassword();
  if (!url) return "no database configured; skipped migrations";

  const result = await runCommand(resolveBinary(), ["up"], {
    env: {
      DATABASE_URL: url,
      DBMATE_NO_DUMP_SCHEMA: "1",
      DBMATE_MIGRATIONS_DIR: fileURLToPath(
        new URL("../schema_migrations/postgres/", import.meta.url),
      ),
    },
  });
  if (!result.success) {
    throw new Error(
      `dbmate up failed (exit ${result.code}): ${result.stderr.trim()}`,
    );
  }
  return `migrations applied\n${result.stdout.trim()}`;
}

// Vercel runs this as the backend build step (`pnpm run build`), where the
// Aurora PG_* variables and VERCEL_OIDC_TOKEN are available. Only production
// builds migrate, so preview branches never alter the shared database.
if (import.meta.main) {
  if (process.env.VERCEL && process.env.VERCEL_ENV !== "production") {
    console.log(`migrations: skipped for ${process.env.VERCEL_ENV} build`);
  } else {
    console.log(`migrations: ${await runMigrations()}`);
  }
}
