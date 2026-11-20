import { z } from "zod";

export const SyncCronRepositoryRecordSchema = z.object({
  sync_cron_repository_id: z.coerce.number(),
  repository_id: z.coerce.number(),
  batch_size: z.coerce.number(),
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

export type SyncCronRepositoryRecord = z.infer<
  typeof SyncCronRepositoryRecordSchema
>;

export const SyncCronRepositoryWithDetailsSchema =
  SyncCronRepositoryRecordSchema.extend({
    org: z.string(),
    name: z.string(),
  });

export type SyncCronRepositoryWithDetails = z.infer<
  typeof SyncCronRepositoryWithDetailsSchema
>;
