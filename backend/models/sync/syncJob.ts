import { z } from "zod";

export const SyncJobSchema = z.object({
  sync_job_id: z.coerce.number(),
  repository_id: z.coerce.number(),
  sync_mode_id: z.union([z.coerce.number(), z.null()]),
  sync_api_key_id: z.union([z.coerce.number(), z.null()]),
  duration_seconds: z.union([z.coerce.number(), z.null()]),
  started_at: z
    .union([z.string(), z.date()])
    .transform((value) =>
      value instanceof Date ? value.toISOString() : value,
    ),
  completed_at: z.union([z.string(), z.date(), z.null()]).transform((value) => {
    if (value === null) {
      return null;
    }
    return value instanceof Date ? value.toISOString() : value;
  }),
  inserted_at: z
    .union([z.string(), z.date()])
    .transform((value) =>
      value instanceof Date ? value.toISOString() : value,
    ),
});

export type SyncJob = z.infer<typeof SyncJobSchema>;
