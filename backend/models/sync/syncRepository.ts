import { z } from "zod";
import { SyncModeSchema } from "./syncMode.ts";

export const SyncRepositoryRecordSchema = z.object({
  sync_repository_id: z.coerce.number(),
  repository_id: z.coerce.number(),
  sync_mode_id: z.coerce.number(),
  num_to_sync: z.coerce.number(),
  active: z.coerce.boolean(),
  inserted_at: z
    .union([z.string(), z.date()])
    .transform((value) =>
      value instanceof Date ? value.toISOString() : value,
    ),
  updated_at: z
    .union([z.string(), z.date()])
    .transform((value) =>
      value instanceof Date ? value.toISOString() : value,
    ),
});

export type SyncRepositoryRecord = z.infer<typeof SyncRepositoryRecordSchema>;

export const SyncRepositoryWithDetailsSchema =
  SyncRepositoryRecordSchema.extend({
    mode_code: SyncModeSchema.shape.code,
    org: z.string(),
    name: z.string(),
  });

export type SyncRepositoryWithDetails = z.infer<
  typeof SyncRepositoryWithDetailsSchema
>;
