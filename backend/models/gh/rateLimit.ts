import { z } from "zod";
export type RateLimit = z.infer<typeof RateLimitSchema>;
export const RateLimitSchema = z.object({
  rate: z.object({
    limit: z.number(),
    used: z.number(),
    remaining: z.number(),
    reset: z.number(),
  }),
});
