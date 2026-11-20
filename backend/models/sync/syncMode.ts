import { z } from "zod";

export const SYNC_MODE_CODES = [
  "LAST_SEEN",
  "LATEST_ISSUES",
  "LATEST_PULL_REQUESTS",
  "SYNC_GITHUB_PROFILES",
  "SYNC_UNSYNCED_GITHUB_PROFILES",
  "SYNC_GITHUB_TEAMS",
] as const;

export const SyncModeCodeSchema = z.enum(SYNC_MODE_CODES);
export type SyncModeCode = z.infer<typeof SyncModeCodeSchema>;

export const SyncModeSchema = z.object({
  sync_mode_id: z.coerce.number(),
  code: z.string(),
  description: z.string().nullable(),
  inserted_at: z
    .union([z.string(), z.date()])
    .transform((value) =>
      value instanceof Date ? value.toISOString() : value,
    ),
});

export type SyncMode = z.infer<typeof SyncModeSchema>;
