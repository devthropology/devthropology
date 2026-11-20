import { z } from "zod";

export const GhTeamSchema = z.object({
  id: z.coerce.number(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable().optional(),
  privacy: z.string().nullable().optional(),
});

export type GhTeam = z.infer<typeof GhTeamSchema>;
