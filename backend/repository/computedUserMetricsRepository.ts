import { z } from "zod";
import {
  ComputedUserMetrics,
  ComputedUserMetricsSchema,
  UserMetricKeyEnum,
  UserMetricPeriodEnum,
} from "../../shared/models/userMetrics.ts";

export const ComputedUserMetricRecordSchema = z.object({
  computedUserMetricsId: z.number(),
  userId: z.number(),
  repositoryId: z.number(),
  metricKey: UserMetricKeyEnum,
  period: UserMetricPeriodEnum,
  value: z.number(),
  rank: z.number().nullable(),
  rankOutOf: z.number().nullable(),
  insertedAt: z.date(),
});

export type ComputedUserMetricRecord = z.infer<
  typeof ComputedUserMetricRecordSchema
>;

export interface ComputedUserMetricsRepository {
  close(): Promise<void>;
  recomputeAllMetricsForRepository(repositoryId: number): Promise<void>;
  recomputePullRequestMetricsForRepository(repositoryId: number): Promise<void>;
  getMetricsForUser(
    repositoryId: number,
    ghLogin: string,
  ): Promise<ComputedUserMetrics>;
}

export const emptyComputedUserMetrics = (): ComputedUserMetrics =>
  ComputedUserMetricsSchema.parse({ metrics: {} });
