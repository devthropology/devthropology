import { IWorkspaceRepository, Workspace } from "./workspaceRepository.ts";
import { SqlClient } from "./sqlClient.ts";

type RawWorkspaceRow = {
  workspace_id: string;
  name: string;
  slug: string;
  workspace_type: string;
  created_by: string | null;
  created_at: Date | string;
};

export class PostgresWorkspaceRepository implements IWorkspaceRepository {
  private readonly sql: SqlClient;

  constructor(sql: SqlClient) {
    this.sql = sql;
  }

  async getAccessibleRepositoryIds(userId: string): Promise<number[]> {
    const rows = await this.sql<{ repository_id: number }[]>`
      SELECT DISTINCT wr.repository_id
      FROM workspace_repository wr
      JOIN workspace_member wm ON wm.workspace_id = wr.workspace_id
      WHERE wm.auth_user_id = ${userId}
      ORDER BY wr.repository_id
    `;
    return rows.map((r) => Number(r.repository_id));
  }

  async canUserAccessRepository(
    userId: string,
    repositoryId: number,
  ): Promise<boolean> {
    const rows = await this.sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM workspace_repository wr
        JOIN workspace_member wm ON wm.workspace_id = wr.workspace_id
        WHERE wm.auth_user_id = ${userId}
          AND wr.repository_id = ${repositoryId}
      ) AS exists
    `;
    return rows[0]?.exists ?? false;
  }

  async getUserWorkspaces(userId: string): Promise<Workspace[]> {
    const rows = await this.sql<RawWorkspaceRow[]>`
      SELECT
        w.workspace_id,
        w.name,
        w.slug,
        w.workspace_type,
        w.created_by,
        w.created_at
      FROM workspace w
      JOIN workspace_member wm ON wm.workspace_id = w.workspace_id
      WHERE wm.auth_user_id = ${userId}
      ORDER BY w.name
    `;
    return rows.map((r) => this.mapWorkspaceRow(r));
  }

  async getAllWorkspaces(): Promise<Workspace[]> {
    const rows = await this.sql<RawWorkspaceRow[]>`
      SELECT
        workspace_id,
        name,
        slug,
        workspace_type,
        created_by,
        created_at
      FROM workspace
      ORDER BY name
    `;
    return rows.map((r) => this.mapWorkspaceRow(r));
  }

  async getWorkspaceById(workspaceId: string): Promise<Workspace | null> {
    const rows = await this.sql<RawWorkspaceRow[]>`
      SELECT
        workspace_id,
        name,
        slug,
        workspace_type,
        created_by,
        created_at
      FROM workspace
      WHERE workspace_id = ${workspaceId}
      LIMIT 1
    `;
    return rows[0] ? this.mapWorkspaceRow(rows[0]) : null;
  }

  async isUserInWorkspace(
    userId: string,
    workspaceId: string,
  ): Promise<boolean> {
    const rows = await this.sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM workspace_member
        WHERE auth_user_id = ${userId}
          AND workspace_id = ${workspaceId}
      ) AS exists
    `;
    return rows[0]?.exists ?? false;
  }

  async getDemoWorkspace(): Promise<Workspace | null> {
    const rows = await this.sql<RawWorkspaceRow[]>`
      SELECT
        workspace_id,
        name,
        slug,
        workspace_type,
        created_by,
        created_at
      FROM workspace
      WHERE workspace_type = 'demo'
      LIMIT 1
    `;
    return rows[0] ? this.mapWorkspaceRow(rows[0]) : null;
  }

  async addUserToWorkspace(
    workspaceId: string,
    userId: string,
    role: "owner" | "member",
  ): Promise<void> {
    await this.sql`
      INSERT INTO workspace_member (workspace_id, auth_user_id, workspace_role)
      VALUES (${workspaceId}, ${userId}, ${role})
      ON CONFLICT (workspace_id, auth_user_id) DO NOTHING
    `;
  }

  async createWorkspace(
    name: string,
    slug: string,
    workspaceType: "demo" | "system" | "user",
    createdBy: string | null,
  ): Promise<Workspace> {
    const rows = await this.sql<RawWorkspaceRow[]>`
      INSERT INTO workspace (name, slug, workspace_type, created_by)
      VALUES (${name}, ${slug}, ${workspaceType}, ${createdBy})
      RETURNING workspace_id, name, slug, workspace_type, created_by, created_at
    `;
    return this.mapWorkspaceRow(rows[0]);
  }

  async addRepositoryToWorkspace(
    workspaceId: string,
    repositoryId: number,
    addedBy: string | null,
  ): Promise<void> {
    await this.sql`
      INSERT INTO workspace_repository (workspace_id, repository_id, added_by)
      VALUES (${workspaceId}, ${repositoryId}, ${addedBy})
      ON CONFLICT (workspace_id, repository_id) DO NOTHING
    `;
  }

  async getWorkspaceRepositories(workspaceId: string): Promise<number[]> {
    const rows = await this.sql<{ repository_id: number | string }[]>`
      SELECT repository_id
      FROM workspace_repository
      WHERE workspace_id = ${workspaceId}
      ORDER BY repository_id
    `;
    return rows.map((r) => Number(r.repository_id));
  }

  private mapWorkspaceRow(row: RawWorkspaceRow): Workspace {
    return {
      workspaceId: row.workspace_id,
      name: row.name,
      slug: row.slug,
      workspaceType: row.workspace_type as "demo" | "system" | "user",
      createdBy: row.created_by,
      createdAt:
        row.created_at instanceof Date
          ? row.created_at
          : new Date(row.created_at),
    };
  }
}
