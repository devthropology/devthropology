import { z } from "zod";

export const SyncCronOutcomeCodeSchema = z.enum([
  "COMPLETE",
  "PARTIAL_RATE_LIMIT",
  "PARTIAL_ERROR",
]);

export type SyncCronOutcomeCode = z.infer<typeof SyncCronOutcomeCodeSchema>;

export const SyncCronRunSchema = z.object({
  sync_cron_run_id: z.coerce.number(),
  sync_cron_repository_id: z.coerce.number(),
  outcome_code: SyncCronOutcomeCodeSchema,
  requested_count: z.coerce.number(),
  processed_count: z.coerce.number(),
  api_keys_used: z.coerce.number(),
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

export type SyncCronRun = z.infer<typeof SyncCronRunSchema>;
