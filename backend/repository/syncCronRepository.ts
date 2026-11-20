import { z } from "zod";
import { SyncApiKey, SyncApiKeySchema } from "../models/sync/syncApiKey.ts";
import {
  SyncCronOutcomeCode,
  SyncCronRun,
  SyncCronRunSchema,
} from "../models/syncCron/syncCronRun.ts";
import {
  SyncCronRepositoryApiKey,
  SyncCronRepositoryApiKeySchema,
} from "../models/syncCron/syncCronRepositoryApiKey.ts";
import {
  SyncCronRepositoryRecord,
  SyncCronRepositoryRecordSchema,
  SyncCronRepositoryWithDetails,
  SyncCronRepositoryWithDetailsSchema,
} from "../models/syncCron/syncCronRepository.ts";
import { SqlClient } from "./sqlClient.ts";

export interface UpsertSyncCronRepositoryParams {
  repositoryId: number;
  batchSize: number;
  active?: boolean;
}

export interface UpsertSyncCronRepositoryApiKeyParams {
  syncCronRepositoryId: number;
  syncApiKeyId: number;
  active?: boolean;
}

export interface InsertSyncCronRunParams {
  syncCronRepositoryId: number;
  outcomeCode: SyncCronOutcomeCode;
  requestedCount: number;
  processedCount: number;
  apiKeysUsed: number;
  startedAt?: Date;
  completedAt?: Date | null;
}

export class SyncCronRepository {
  private sql: SqlClient;

  constructor(sql: SqlClient) {
    this.sql = sql;
  }

  async close(): Promise<void> {
    // No-op: caller owns SqlClient lifecycle
  }

  async upsertRepository(
    params: UpsertSyncCronRepositoryParams,
  ): Promise<SyncCronRepositoryRecord> {
    const rows = await this.sql`
      INSERT INTO sync_cron_repositories (repository_id, batch_size, active)
      VALUES (${params.repositoryId}, ${params.batchSize}, ${
        params.active ?? true
      })
      ON CONFLICT (repository_id)
      DO UPDATE SET
        batch_size = EXCLUDED.batch_size,
        active = EXCLUDED.active,
        updated_at = now()
      RETURNING
        sync_cron_repository_id,
        repository_id,
        batch_size,
        active,
        inserted_at,
        updated_at
    `;

    return SyncCronRepositoryRecordSchema.parse(rows[0]);
  }

  async getActiveRepositories(): Promise<SyncCronRepositoryWithDetails[]> {
    const rows = await this.sql`
      SELECT
        scr.sync_cron_repository_id,
        scr.repository_id,
        scr.batch_size,
        scr.active,
        scr.inserted_at,
        scr.updated_at,
        r.org,
        r.name
      FROM sync_cron_repositories scr
      INNER JOIN repository r ON r.repository_id = scr.repository_id
      WHERE scr.active = true
      ORDER BY scr.repository_id
    `;

    return z.array(SyncCronRepositoryWithDetailsSchema).parse(rows);
  }

  async upsertRepositoryApiKey(
    params: UpsertSyncCronRepositoryApiKeyParams,
  ): Promise<SyncCronRepositoryApiKey> {
    const rows = await this.sql`
      INSERT INTO sync_cron_repository_api_keys (
        sync_cron_repository_id,
        sync_api_key_id,
        active
      )
      VALUES (
        ${params.syncCronRepositoryId},
        ${params.syncApiKeyId},
        ${params.active ?? true}
      )
      ON CONFLICT (sync_cron_repository_id, sync_api_key_id)
      DO UPDATE SET
        active = EXCLUDED.active,
        updated_at = now()
      RETURNING
        sync_cron_repository_api_key_id,
        sync_cron_repository_id,
        sync_api_key_id,
        active,
        inserted_at,
        updated_at
    `;

    return SyncCronRepositoryApiKeySchema.parse(rows[0]);
  }

  async getApiKeysForRepository(
    syncCronRepositoryId: number,
  ): Promise<SyncApiKey[]> {
    const rows = await this.sql`
      SELECT
        sak.sync_api_key_id,
        sak.api_key,
        sak.gh_username,
        sak.active,
        sak.inserted_at,
        sak.updated_at
      FROM sync_cron_repository_api_keys scrak
      INNER JOIN sync_api_keys sak ON sak.sync_api_key_id = scrak.sync_api_key_id
      WHERE scrak.sync_cron_repository_id = ${syncCronRepositoryId}
        AND scrak.active = true
        AND sak.active = true
      ORDER BY sak.sync_api_key_id
    `;

    return z.array(SyncApiKeySchema).parse(rows);
  }

  async getLatestRun(): Promise<SyncCronRun | null> {
    const rows = await this.sql`
      SELECT
        sync_cron_run_id,
        sync_cron_repository_id,
        outcome_code,
        requested_count,
        processed_count,
        api_keys_used,
        started_at,
        completed_at,
        inserted_at
      FROM sync_cron_runs
      ORDER BY started_at DESC, sync_cron_run_id DESC
      LIMIT 1
    `;

    if (rows.length === 0) {
      return null;
    }

    return SyncCronRunSchema.parse(rows[0]);
  }

  async insertRun(params: InsertSyncCronRunParams): Promise<SyncCronRun> {
    const rows = await this.sql`
      INSERT INTO sync_cron_runs (
        sync_cron_repository_id,
        outcome_code,
        requested_count,
        processed_count,
        api_keys_used,
        started_at,
        completed_at
      )
      VALUES (
        ${params.syncCronRepositoryId},
        ${params.outcomeCode},
        ${params.requestedCount},
        ${params.processedCount},
        ${params.apiKeysUsed},
        ${params.startedAt ?? new Date()},
        ${params.completedAt ?? null}
      )
      RETURNING
        sync_cron_run_id,
        sync_cron_repository_id,
        outcome_code,
        requested_count,
        processed_count,
        api_keys_used,
        started_at,
        completed_at,
        inserted_at
    `;

    return SyncCronRunSchema.parse(rows[0]);
  }
}
