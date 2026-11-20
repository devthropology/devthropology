import type { SqlClient } from "../../repository/sqlClient.ts";
import type { AuthUser } from "../../models/auth.ts";

export interface AvailableRepository {
  id: number;
  org: string;
  name: string;
  private: boolean;
}
export interface ConnectionAttempt {
  workspaceId: string;
  verifier: string;
  installationId: string | null;
}
export interface GithubConnection {
  workspaceId: string;
  installationId: string;
  accountLogin: string | null;
}

export class ConnectionError extends Error {}

export class GithubConnectionsRepository {
  constructor(private readonly sql: SqlClient) {}

  async ownedWorkspaces(
    user: AuthUser,
  ): Promise<{ workspaceId: string; name: string }[]> {
    return await this.sql<{ workspaceId: string; name: string }[]>`
      SELECT w.workspace_id AS "workspaceId", w.name FROM workspace w
      WHERE ${user.role !== "demo"} AND (${
        user.role === "superuser"
      } OR EXISTS (
        SELECT 1 FROM workspace_member m WHERE m.workspace_id = w.workspace_id
        AND m.auth_user_id = ${user.userId} AND m.workspace_role = 'owner'
      )) ORDER BY w.name
    `;
  }

  async requireOwner(user: AuthUser, workspaceId: string) {
    if (
      !(await this.ownedWorkspaces(user)).some(
        (w) => w.workspaceId === workspaceId,
      )
    ) {
      throw new ConnectionError("Workspace owner permission is required.");
    }
  }

  async saveAttempt(
    user: AuthUser,
    stateHash: string,
    attempt: ConnectionAttempt,
  ) {
    await this
      .sql`DELETE FROM github_repository_attempt WHERE expires_at < now()`;
    await this.sql`
      INSERT INTO github_repository_attempt (state_hash, auth_user_id, workspace_id, code_verifier, installation_id)
      VALUES (${stateHash}, ${user.userId}, ${attempt.workspaceId}, ${attempt.verifier}, ${attempt.installationId})
    `;
  }

  async consumeAttempt(user: AuthUser, hash: string) {
    const rows = await this.sql<ConnectionAttempt[]>`
      DELETE FROM github_repository_attempt WHERE state_hash = ${hash}
      AND auth_user_id = ${user.userId} AND expires_at > now()
      RETURNING workspace_id AS "workspaceId", code_verifier AS verifier, installation_id::text AS "installationId"
    `;
    if (!rows[0]) {
      throw new ConnectionError(
        "Setup expired. Please add repositories again.",
      );
    }
    await this.requireOwner(user, rows[0].workspaceId);
    return rows[0];
  }

  async identity(user: AuthUser) {
    const rows = await this.sql<{ id: string }[]>`
      SELECT github_user_id AS id FROM github_identity WHERE auth_user_id = ${user.userId}
    `;
    if (!rows[0]) {
      throw new ConnectionError("Sign in with GitHub to connect repositories.");
    }
    return rows[0].id;
  }

  async connections(user: AuthUser): Promise<GithubConnection[]> {
    return await this.sql<GithubConnection[]>`
      SELECT i.workspace_id AS "workspaceId", i.installation_id::text AS "installationId", i.account_login AS "accountLogin"
      FROM workspace_github_installation i
      WHERE ${user.role !== "demo"} AND (${
        user.role === "superuser"
      } OR EXISTS (
        SELECT 1 FROM workspace_member m WHERE m.workspace_id = i.workspace_id
        AND m.auth_user_id = ${user.userId} AND m.workspace_role = 'owner'
      )) ORDER BY i.account_login NULLS LAST, i.installation_id
    `;
  }

  async connection(
    user: AuthUser,
    workspaceId: string,
    installationId: string,
  ) {
    await this.requireOwner(user, workspaceId);
    const rows = await this.sql<GithubConnection[]>`
      SELECT workspace_id AS "workspaceId", installation_id::text AS "installationId", account_login AS "accountLogin"
      FROM workspace_github_installation WHERE workspace_id = ${workspaceId} AND installation_id = ${installationId}
    `;
    if (!rows[0]) {
      throw new ConnectionError(
        "Connect this GitHub installation to your workspace first.",
      );
    }
    return rows[0];
  }

  async addedRepositoryIds(workspaceId: string): Promise<number[]> {
    const rows = await this.sql<{ id: string }[]>`
      SELECT r.github_repository_id::text AS id
      FROM workspace_repository wr
      JOIN repository r ON r.repository_id = wr.repository_id
      WHERE wr.workspace_id = ${workspaceId} AND r.github_repository_id IS NOT NULL
    `;
    return rows.map((row) => Number(row.id));
  }

  async saveConnection(
    user: AuthUser,
    workspaceId: string,
    installationId: string,
    accountLogin: string,
  ) {
    await this.requireOwner(user, workspaceId);
    const rows = await this.sql`
      INSERT INTO workspace_github_installation (installation_id, workspace_id, connected_by, account_login)
      VALUES (${installationId}, ${workspaceId}, ${user.userId}, ${accountLogin})
      ON CONFLICT (installation_id) DO UPDATE SET account_login = EXCLUDED.account_login, connected_by = EXCLUDED.connected_by
      WHERE workspace_github_installation.workspace_id = EXCLUDED.workspace_id
      RETURNING installation_id
    `;
    if (!rows[0]) {
      throw new ConnectionError(
        "This GitHub installation is already connected to another workspace.",
      );
    }
  }

  // The provider verification happens before this transaction. Reuse the existing
  // global repository + workspace link model, and record the authorizing installation.
  async attach(
    user: AuthUser,
    connection: GithubConnection,
    repositories: AvailableRepository[],
  ) {
    await this.sql.begin(async (sql) => {
      const connected = await sql`
        SELECT 1 FROM workspace_github_installation
        WHERE installation_id = ${connection.installationId} AND workspace_id = ${connection.workspaceId}
        AND account_login IS NOT NULL FOR SHARE
      `;
      if (!connected[0]) {
        throw new ConnectionError(
          "Reconnect GitHub before adding repositories.",
        );
      }
      // Acquire repository locks in stable ID order to avoid deadlocks between adds.
      for (const repo of [...repositories].sort((a, b) => a.id - b.id)) {
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`github-repository:${repo.id}`}, 0))`;
        // One GitHub repository ID has one canonical org/name globally. Renames
        // and transfers update that shared record; forks have distinct IDs.
        // Never replace a different non-null ID on an org/name collision: doing
        // so would merge unrelated history and workspace access. Reject instead.
        let rows = await sql<{ repository_id: string }[]>`
          SELECT repository_id FROM repository WHERE github_repository_id = ${repo.id} FOR UPDATE
        `;
        if (!rows[0]) {
          rows = await sql<{ repository_id: string }[]>`
            INSERT INTO repository (org, name, github_repository_id)
            VALUES (${repo.org}, ${repo.name}, ${repo.id})
            ON CONFLICT (org, name) DO UPDATE SET github_repository_id = EXCLUDED.github_repository_id
            WHERE repository.github_repository_id IS NULL OR repository.github_repository_id = EXCLUDED.github_repository_id
            RETURNING repository_id
          `;
        }
        if (!rows[0]) {
          throw new ConnectionError(
            "Repository identity changed. Contact an administrator before reconnecting it.",
          );
        }
        const id = rows[0].repository_id;
        await sql`UPDATE repository SET org = ${repo.org}, name = ${repo.name} WHERE repository_id = ${id}`;
        await sql`
          INSERT INTO workspace_repository (workspace_id, repository_id, added_by)
          VALUES (${connection.workspaceId}, ${id}, ${user.userId}) ON CONFLICT DO NOTHING
        `;
        await sql`
          INSERT INTO workspace_github_repository (workspace_id, repository_id, installation_id)
          VALUES (${connection.workspaceId}, ${id}, ${connection.installationId})
          ON CONFLICT (workspace_id, repository_id) DO UPDATE SET installation_id = EXCLUDED.installation_id
        `;
      }
    });
  }
}
