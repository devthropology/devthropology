import { afterEach, beforeEach, describe, it } from "vitest";
import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { getTestDatabase } from "../testUtils/testDatabase.ts";
import { createSqlClient } from "./sqlClient.ts";
import { PostgresTeamRepository } from "./postgresTeamRepository.ts";

describe("PostgresTeamRepository", () => {
  let teamRepository: PostgresTeamRepository;
  let sql: ReturnType<typeof createSqlClient>;

  beforeEach(async () => {
    const testDb = await getTestDatabase();
    sql = createSqlClient(testDb.connectionString);
    teamRepository = new PostgresTeamRepository(sql);
  });

  afterEach(async () => {
    await teamRepository.close();
    await sql.end();
  });

  it("creates a manual team and replaces its members", async () => {
    const repositoryId = 1;
    const teamName = `Core Team ${crypto.randomUUID().slice(0, 8)}`;
    const userIds = await getUserIdsByLogin(sql, [
      "danderson",
      "crawshaw",
      "bradfitz",
    ]);

    const created = await teamRepository.createManualTeam(
      repositoryId,
      teamName,
      userIds,
    );

    assertEquals(created.repositoryId, repositoryId);
    assertEquals(created.name, teamName);
    assertEquals(created.slug.startsWith("core-team-"), true);
    assertEquals(created.sourceType, "manual");
    assertEquals(created.memberCount, 3);

    const initialMembers = await teamRepository.getTeamMembers(
      repositoryId,
      created.teamId,
    );
    assertEquals(
      initialMembers.map((member) => member.ghLogin),
      ["bradfitz", "crawshaw", "danderson"],
    );

    const replacementIds = await getUserIdsByLogin(sql, [
      "danderson",
      "bradfitz",
    ]);
    const replaced = await teamRepository.replaceTeamMembers(
      repositoryId,
      created.teamId,
      replacementIds,
    );

    assertEquals(
      replaced.map((member) => member.ghLogin),
      ["bradfitz", "danderson"],
    );

    const refreshed = await teamRepository.getTeamById(
      repositoryId,
      created.teamId,
    );
    assertEquals(refreshed?.memberCount, 2);
  });

  it("upserts a GitHub team and syncs members with roles", async () => {
    const repositoryId = 1;
    const ghTeamId = Math.floor(Math.random() * 1_000_000_000);
    const slugSuffix = crypto.randomUUID().slice(0, 8);
    const [dandersonId, crawshawId] = await getUserIdsByLogin(sql, [
      "danderson",
      "crawshaw",
    ]);

    const created = await teamRepository.upsertGithubTeam({
      repositoryId,
      name: `Networking ${slugSuffix}`,
      slug: `networking-${slugSuffix}`,
      ghTeamId,
      ghOrgLogin: "tailscale",
    });

    assertEquals(created.sourceType, "github");
    assertEquals(created.ghTeamId, ghTeamId);

    const syncedMembers = await teamRepository.replaceGithubTeamMembers(
      repositoryId,
      created.teamId,
      [
        { userId: dandersonId, role: "maintainer" },
        { userId: crawshawId, role: "member" },
      ],
    );

    assertEquals(
      syncedMembers.map((member) => member.ghLogin),
      ["crawshaw", "danderson"],
    );
    assertEquals(
      syncedMembers.map((member) => member.memberRole),
      ["member", "maintainer"],
    );

    const updated = await teamRepository.upsertGithubTeam({
      repositoryId,
      name: `Networking and Infra ${slugSuffix}`,
      slug: `networking-and-infra-${slugSuffix}`,
      ghTeamId,
      ghOrgLogin: "tailscale",
    });

    assertEquals(updated.teamId, created.teamId);
    assertEquals(updated.name, `Networking and Infra ${slugSuffix}`);
    assertEquals(updated.slug, `networking-and-infra-${slugSuffix}`);
  });
});

async function getUserIdsByLogin(
  sql: ReturnType<typeof createSqlClient>,
  logins: string[],
): Promise<number[]> {
  const rows = await sql.unsafe<
    { user_id: number | string; gh_login: string }[]
  >(
    `
      SELECT user_id, gh_login
      FROM "user"
      WHERE gh_login = ANY($1::text[])
      ORDER BY array_position($1::text[], gh_login)
    `,
    [logins],
  );

  return rows.map((row) => Number(row.user_id));
}
