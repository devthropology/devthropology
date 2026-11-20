import { z } from "zod";
import {
  RepositoryDetails,
  RepositoryDetailsSchema,
} from "../models/dbTypes.ts";
import { SqlClient } from "./sqlClient.ts";

export interface IRepositoryRepository {
  insertRepository(org: string, name: string): Promise<RepositoryDetails>;
  insertRepositoryInWorkspace(
    org: string,
    name: string,
    workspaceId: string,
    addedBy: string | null,
  ): Promise<RepositoryDetails>;
  getAllRepositories(): Promise<RepositoryDetails[]>;
  clearAllRepositories(): Promise<void>;
  close(): Promise<void>;
}

export class RepositoryRepository implements IRepositoryRepository {
  private sql: SqlClient;

  constructor(sql: SqlClient) {
    this.sql = sql;
  }

  async close(): Promise<void> {
    // No-op: caller owns SqlClient lifecycle
  }

  async insertRepository(
    org: string,
    name: string,
  ): Promise<RepositoryDetails> {
    const query = `
      INSERT INTO repository (org, name)
      VALUES ($1, $2)
      RETURNING repository_id, org, name
    `;
    const result = await this.sql.unsafe(query, [org, name]);
    if (result.length === 0) {
      throw new Error("Failed to insert repository");
    }
    return RepositoryDetailsSchema.parse(result[0]);
  }

  async insertRepositoryInWorkspace(
    org: string,
    name: string,
    workspaceId: string,
    addedBy: string | null,
  ): Promise<RepositoryDetails> {
    const query = `
      WITH inserted_repo AS (
        INSERT INTO repository (org, name)
        VALUES ($1, $2)
        RETURNING repository_id, org, name
      ), inserted_link AS (
        INSERT INTO workspace_repository (workspace_id, repository_id, added_by)
        SELECT $3, repository_id, $4 FROM inserted_repo
        RETURNING repository_id
      )
      SELECT r.repository_id, r.org, r.name
      FROM inserted_repo r
      JOIN inserted_link l ON l.repository_id = r.repository_id
    `;

    const result = await this.sql.unsafe(query, [
      org,
      name,
      workspaceId,
      addedBy,
    ]);

    if (result.length === 0) {
      throw new Error("Failed to insert repository");
    }

    return RepositoryDetailsSchema.parse(result[0]);
  }

  async getAllRepositories(): Promise<RepositoryDetails[]> {
    const query =
      "SELECT repository_id, org, name FROM repository ORDER BY repository_id";
    const result = await this.sql.unsafe(query);
    return z.array(RepositoryDetailsSchema).parse(result);
  }

  async clearAllRepositories(): Promise<void> {
    await this.sql`DELETE FROM repository`;
  }
}
