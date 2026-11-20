import { z } from "zod";

export const SyncCronRepositoryApiKeySchema = z.object({
  sync_cron_repository_api_key_id: z.coerce.number(),
  sync_cron_repository_id: z.coerce.number(),
  sync_api_key_id: z.coerce.number(),
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

export type SyncCronRepositoryApiKey = z.infer<
  typeof SyncCronRepositoryApiKeySchema
>;
