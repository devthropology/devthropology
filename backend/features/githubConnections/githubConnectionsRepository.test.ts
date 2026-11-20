import { test } from "vitest";
import {
  deepStrictEqual as assertEquals,
  ok as assert,
  rejects as assertRejects,
} from "node:assert/strict";
import { getTestDatabase } from "../../testUtils/testDatabase.ts";
import { createSqlClient } from "../../repository/sqlClient.ts";
import { GithubLoginRepository } from "../githubLogin/githubLoginRepository.ts";
import { GithubConnectionsService } from "./githubConnectionsService.ts";
import {
  type AvailableRepository,
  ConnectionError,
  GithubConnectionsRepository,
} from "./githubConnectionsRepository.ts";
import type { AuthUser } from "../../models/auth.ts";

test("GitHub connections: Postgres authorization and canonical repository persistence", async () => {
  const { connectionString } = await getTestDatabase();
  const sql = createSqlClient(connectionString);
  const repository = new GithubConnectionsRepository(sql);
  const login = new GithubLoginRepository(sql);
  const namespace = `connection-${crypto.randomUUID()}`;
  const users: AuthUser[] = [];
  const workspaces: string[] = [];
  const base = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  const installationId = String(base);
  const identities = ["owner", "member", "outsider"].map(
    (name) => `${namespace}-${name}`,
  );
  try {
    for (const identity of identities) {
      const account = await login.provision(identity, identity);
      assert(account);
      users.push({
        userId: account.userId,
        username: account.username,
        role: account.role,
      });
      const owned = await repository.ownedWorkspaces(account);
      assertEquals(owned.length, 1);
      workspaces.push(owned[0].workspaceId);
    }
    const [owner, member, outsider] = users;
    const workspaceId = workspaces[0];
    await sql`
        INSERT INTO workspace_member (workspace_id, auth_user_id, workspace_role)
        VALUES (${workspaceId}, ${member.userId}, 'member')
      `;
    await repository.saveConnection(
      owner,
      workspaceId,
      installationId,
      namespace,
    );
    const connection = await repository.connection(
      owner,
      workspaceId,
      installationId,
    );
    const repo: AvailableRepository = {
      id: base + 1,
      org: namespace,
      name: "legacy",
      private: true,
    };

    // Unrelated users and non-owner members are denied before GitHub requests or workspace writes.
    let fetchCalls = 0;
    let keyReads = 0;
    const service = new GithubConnectionsService(
      repository,
      () => ({
        appId: "123",
        slug: "test",
        keyPath: "must-not-read.pem",
        clientId: "client",
        clientSecret: "secret",
        callbackUrl: "https://frontend.test/app/settings/github",
      }),
      () => {
        fetchCalls++;
        throw new Error("Unauthorized request reached GitHub");
      },
      () => {
        keyReads++;
        throw new Error(
          "Unauthorized request tried to mint an installation token",
        );
      },
    );
    const beforeUnauthorizedRequests =
      await sql`SELECT * FROM workspace_repository WHERE workspace_id IN ${sql(
        workspaces,
      )}`;
    for (const actor of [member, outsider]) {
      assertEquals([...(await service.listConnections(actor))], []);
      assert(
        !(await service.listWorkspaces(actor)).some(
          (w) => w.workspaceId === workspaceId,
        ),
      );
      await assertRejects(
        () => service.available(actor, workspaceId, installationId),
        (error: unknown) =>
          error instanceof ConnectionError &&
          error.message.includes("owner permission"),
      );
      await assertRejects(
        () => service.add(actor, workspaceId, installationId, [repo.id]),
        (error: unknown) =>
          error instanceof ConnectionError &&
          error.message.includes("owner permission"),
      );
    }
    // Owning another workspace must not let a user borrow this installation.
    await assertRejects(
      () => service.available(outsider, workspaces[2], installationId),
      (error: unknown) =>
        error instanceof ConnectionError &&
        error.message.includes("Connect this GitHub installation"),
    );
    await assertRejects(
      () => service.add(outsider, workspaces[2], installationId, [repo.id]),
      (error: unknown) =>
        error instanceof ConnectionError &&
        error.message.includes("Connect this GitHub installation"),
    );
    await assertRejects(
      () =>
        repository.saveConnection(
          outsider,
          workspaces[2],
          installationId,
          "replacement",
        ),
      (error: unknown) =>
        error instanceof ConnectionError &&
        error.message.includes("another workspace"),
    );
    assertEquals(
      await repository.connection(owner, workspaceId, installationId),
      connection,
    );
    assertEquals(fetchCalls, 0, "Unauthorized access must not call GitHub");
    assertEquals(
      keyReads,
      0,
      "Unauthorized access must not read the signing key",
    );
    assertEquals(
      [
        ...(await sql`SELECT * FROM workspace_repository WHERE workspace_id IN ${sql(
          workspaces,
        )}`),
      ],
      [...beforeUnauthorizedRequests],
    );

    // Adopts a legacy repository and repeats additions without duplicate links or changing provenance.
    const [legacy] = await sql`
      INSERT INTO repository (org, name) VALUES (${repo.org}, ${repo.name})
      RETURNING repository_id::text AS id
    `;
    const internalId = legacy.id;
    // The unverified-connection gate is enforced against actual persisted state.
    await sql`UPDATE workspace_github_installation SET account_login = NULL WHERE installation_id = ${installationId}`;
    await assertRejects(
      () => repository.attach(owner, connection, [repo]),
      (error: unknown) =>
        error instanceof ConnectionError &&
        error.message.includes("Reconnect GitHub"),
    );
    const [untouched] =
      await sql`SELECT github_repository_id FROM repository WHERE repository_id = ${internalId}`;
    assertEquals(untouched.github_repository_id, null);
    assertEquals(
      (
        await sql`SELECT 1 FROM workspace_repository WHERE workspace_id = ${workspaceId}`
      ).length,
      0,
    );
    await repository.saveConnection(
      owner,
      workspaceId,
      installationId,
      namespace,
    );
    await repository.attach(owner, connection, [repo]);
    await Promise.all([
      repository.attach(owner, connection, [repo]),
      repository.attach(owner, connection, [repo]),
    ]);
    const records = await sql`
      SELECT repository_id::text AS id, github_repository_id::text AS github_id FROM repository WHERE org = ${namespace}
    `;
    assertEquals(
      [...records],
      [
        {
          id: internalId,
          github_id: String(repo.id),
        },
      ],
    );
    const links = await sql`
      SELECT repository_id::text AS id, added_by FROM workspace_repository WHERE workspace_id = ${workspaceId}
    `;
    assertEquals(
      [...links],
      [
        {
          id: internalId,
          added_by: owner.userId,
        },
      ],
    );
    const provenance = await sql`
      SELECT repository_id::text AS id, installation_id::text AS installation FROM workspace_github_repository WHERE workspace_id = ${workspaceId}
    `;
    assertEquals(
      [...provenance],
      [
        {
          id: internalId,
          installation: installationId,
        },
      ],
    );

    // Renames preserve global identity and ID collisions roll back the entire addition.
    // Another workspace's existing link should continue pointing at the same
    // canonical repository after a rename, not at a newly inserted record.
    await sql`
      INSERT INTO workspace_repository (workspace_id, repository_id, added_by)
      VALUES (${workspaces[2]}, ${internalId}, ${outsider.userId})
    `;
    const renamed = { ...repo, name: "renamed" };
    await repository.attach(owner, connection, [renamed]);
    const [afterRename] = await sql`
      SELECT repository_id::text AS id, name FROM repository WHERE github_repository_id = ${repo.id}
    `;
    assertEquals(
      afterRename,
      { id: internalId, name: "renamed" },
      "Renaming must preserve the canonical repository ID",
    );
    const sharedLinks =
      await sql`SELECT repository_id::text AS id FROM workspace_repository WHERE repository_id = ${internalId}`;
    assertEquals(
      [...sharedLinks],
      [
        { id: internalId },
        {
          id: internalId,
        },
      ],
    );
    await sql`
      INSERT INTO repository (org, name, github_repository_id)
      VALUES (${namespace}, 'collision', ${base + 5})
    `;
    const before = await sql`
      SELECT repository_id, org, name, github_repository_id FROM repository WHERE org = ${namespace} ORDER BY repository_id
    `;
    const linksBefore =
      await sql`SELECT * FROM workspace_repository WHERE workspace_id IN ${sql(
        workspaces,
      )} ORDER BY workspace_id, repository_id`;
    const provenanceBefore =
      await sql`SELECT * FROM workspace_github_repository WHERE workspace_id = ${workspaceId} ORDER BY repository_id`;
    // First item would succeed; the second must reject rather than replacing
    // another repository's GitHub ID. Transaction rollback undoes item one.
    await assertRejects(
      () =>
        repository.attach(owner, connection, [
          { ...repo, id: base + 2, name: "must-roll-back" },
          { ...repo, id: base + 4, name: "collision" },
        ]),
      (error: unknown) =>
        error instanceof ConnectionError &&
        error.message.includes("Repository identity changed"),
    );
    assertEquals(
      [
        ...(await sql`SELECT repository_id, org, name, github_repository_id FROM repository WHERE org = ${namespace} ORDER BY repository_id`),
      ],
      [...before],
    );
    assertEquals(
      [
        ...(await sql`SELECT * FROM workspace_repository WHERE workspace_id IN ${sql(
          workspaces,
        )} ORDER BY workspace_id, repository_id`),
      ],
      [...linksBefore],
    );
    assertEquals(
      [
        ...(await sql`SELECT * FROM workspace_github_repository WHERE workspace_id = ${workspaceId} ORDER BY repository_id`),
      ],
      [...provenanceBefore],
    );
  } finally {
    // Delete only this fixture, in FK order; never clear shared test tables.
    if (workspaces.length) {
      await sql`DELETE FROM workspace_github_repository WHERE workspace_id IN ${sql(
        workspaces,
      )}`;
      await sql`DELETE FROM workspace_github_installation WHERE workspace_id IN ${sql(
        workspaces,
      )}`;
      await sql`DELETE FROM github_repository_attempt WHERE workspace_id IN ${sql(
        workspaces,
      )}`;
      await sql`DELETE FROM workspace_repository WHERE workspace_id IN ${sql(
        workspaces,
      )}`;
      await sql`DELETE FROM workspace WHERE workspace_id IN ${sql(workspaces)}`;
    }
    await sql`DELETE FROM repository WHERE org = ${namespace}`;
    await sql`DELETE FROM github_identity WHERE github_user_id IN ${sql(
      identities,
    )}`;
    if (users.length) {
      await sql`DELETE FROM auth_users WHERE auth_user_id IN ${sql(
        users.map((u) => u.userId),
      )}`;
    }
    await sql.end();
  }
});
