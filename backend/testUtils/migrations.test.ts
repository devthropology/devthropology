import { test } from "vitest";
import { strictEqual } from "node:assert/strict";
import { getEmptyTestDatabase, runMigrations } from "./testDatabase.ts";
import { createSqlClient } from "../repository/sqlClient.ts";

test("database fixtures run native dbmate migrations without a runtime task subprocess", async () => {
  const connectionString = await getEmptyTestDatabase();
  await runMigrations(connectionString);
  const sql = createSqlClient(connectionString);
  try {
    const [row] =
      await sql`SELECT to_regclass('public.auth_users')::text AS name`;
    strictEqual(row.name, "auth_users");
    // Re-running an already migrated database must also succeed.
    await runMigrations(connectionString);
  } finally {
    await sql.end();
  }
});
