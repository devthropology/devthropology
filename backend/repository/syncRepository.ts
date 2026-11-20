import { z } from "zod";
import { SyncApiKey, SyncApiKeySchema } from "../models/sync/syncApiKey.ts";
import { SyncJob, SyncJobSchema } from "../models/sync/syncJob.ts";
import { SyncMode, SyncModeSchema } from "../models/sync/syncMode.ts";
import {
  SyncRepositoryRecord,
  SyncRepositoryRecordSchema,
  SyncRepositoryWithDetails,
  SyncRepositoryWithDetailsSchema,
} from "../models/sync/syncRepository.ts";
import { SqlClient } from "./sqlClient.ts";

export interface InsertApiKeyParams {
  apiKey: string;
  ghUsername: string;
  active?: boolean;
}

export interface InsertRepositoryToSyncParams {
  repositoryId: number;
  syncModeCode: string;
  numToSync: number;
  active?: boolean;
}

export interface InsertSyncJobParams {
  repositoryId: number;
  syncModeCode: string;
  syncApiKeyId: number | null;
  durationSeconds: number | null;
  startedAt?: Date;
  completedAt?: Date | null;
}

export class SyncRepository {
  private sql: SqlClient;

  constructor(sql: SqlClient) {
    this.sql = sql;
  }

  async close(): Promise<void> {
    // No-op: caller owns SqlClient lifecycle
  }

  async insertApiKey(params: InsertApiKeyParams): Promise<SyncApiKey> {
    const rows = await this.sql`
      INSERT INTO sync_api_keys (api_key, gh_username, active)
      VALUES (${params.apiKey}, ${params.ghUsername}, ${params.active ?? true})
      ON CONFLICT (api_key)
      DO UPDATE SET
        gh_username = EXCLUDED.gh_username,
        active = EXCLUDED.active,
        updated_at = now()
      RETURNING
        sync_api_key_id,
        api_key,
        gh_username,
        active,
        inserted_at,
        updated_at
    `;
    return SyncApiKeySchema.parse(rows[0]);
  }

  async getActiveApiKeys(): Promise<SyncApiKey[]> {
    const rows = await this.sql`
      SELECT
        sync_api_key_id,
        api_key,
        gh_username,
        active,
        inserted_at,
        updated_at
      FROM sync_api_keys
      WHERE active = true
      ORDER BY sync_api_key_id
    `;
    return z.array(SyncApiKeySchema).parse(rows);
  }

  async listSyncModes(): Promise<SyncMode[]> {
    const rows = await this.sql`
      SELECT sync_mode_id, code, description, inserted_at
      FROM sync_modes
      ORDER BY sync_mode_id
    `;
    return z.array(SyncModeSchema).parse(rows);
  }

  async insertRepositoryToSync(
    params: InsertRepositoryToSyncParams,
  ): Promise<SyncRepositoryRecord> {
    const mode = await this.getSyncModeFromCode(params.syncModeCode);
    const rows = await this.sql`
      INSERT INTO sync_repositories (
        repository_id,
        sync_mode_id,
        num_to_sync,
        active
      )
      VALUES (
        ${params.repositoryId},
        ${mode.sync_mode_id},
        ${params.numToSync},
        ${params.active ?? true}
      )
      ON CONFLICT (repository_id, sync_mode_id)
      DO UPDATE SET
        num_to_sync = EXCLUDED.num_to_sync,
        active = EXCLUDED.active,
        updated_at = now()
      RETURNING
        sync_repository_id,
        repository_id,
        sync_mode_id,
        num_to_sync,
        active,
        inserted_at,
        updated_at
    `;
    return SyncRepositoryRecordSchema.parse(rows[0]);
  }

  async getRepositoriesToSync(): Promise<SyncRepositoryWithDetails[]> {
    const rows = await this.sql`
      SELECT
        sr.sync_repository_id,
        sr.repository_id,
        sr.sync_mode_id,
        sr.num_to_sync,
        sr.active,
        sr.inserted_at,
        sr.updated_at,
        sm.code AS mode_code,
        r.org,
        r.name
      FROM sync_repositories sr
      INNER JOIN sync_modes sm ON sm.sync_mode_id = sr.sync_mode_id
      INNER JOIN repository r ON r.repository_id = sr.repository_id
      WHERE sr.active = true
      ORDER BY sr.sync_repository_id
    `;
    return z.array(SyncRepositoryWithDetailsSchema).parse(rows);
  }

  async insertSyncJob(params: InsertSyncJobParams): Promise<SyncJob> {
    const mode = await this.getSyncModeFromCode(params.syncModeCode);
    const startedAt = params.startedAt ?? new Date();
    const completedAt = params.completedAt ?? null;

    const rows = await this.sql`
      INSERT INTO sync_jobs (
        repository_id,
        sync_mode_id,
        sync_api_key_id,
        duration_seconds,
        started_at,
        completed_at
      )
      VALUES (
        ${params.repositoryId},
        ${mode.sync_mode_id},
        ${params.syncApiKeyId},
        ${params.durationSeconds},
        ${startedAt},
        ${completedAt}
      )
      RETURNING
        sync_job_id,
        repository_id,
        sync_mode_id,
        sync_api_key_id,
        duration_seconds,
        started_at,
        completed_at,
        inserted_at
    `;
    return SyncJobSchema.parse(rows[0]);
  }

  private async getSyncModeFromCode(code: string): Promise<SyncMode> {
    const targetCode = code.toUpperCase();

    const rows = await this.sql`
      SELECT sync_mode_id, code, description, inserted_at
      FROM sync_modes
      WHERE code = ${targetCode}
      LIMIT 1
    `;

    if (rows.length === 0) {
      throw new Error(`Sync mode not found for code: ${code}`);
    }

    return SyncModeSchema.parse(rows[0]);
  }
}
