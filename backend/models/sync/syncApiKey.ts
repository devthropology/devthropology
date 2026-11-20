import { z } from "zod";

export const SyncApiKeySchema = z.object({
  sync_api_key_id: z.coerce.number(),
  api_key: z.string(),
  gh_username: z.string(),
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

export type SyncApiKey = z.infer<typeof SyncApiKeySchema>;
