import { z } from "zod";

// Repository overview data for the frontend dashboard
export const RepositoryOverviewSchema = z.object({
  // Repository metadata
  repositoryName: z.string(),
  repositoryOrg: z.string(),
  fullName: z.string(), // computed: "{org}/{name}"
  githubUrl: z.string(), // computed: "https://github.com/{org}/{name}"

  // Activity timeline
  firstActivity: z.string().nullable(), // ISO date string
  lastActivity: z.string().nullable(), // ISO date string

  // User metrics
  totalUsers: z.number(),
  activeUsers3mo: z.number(),
  medianAuthorAge3moDays: z.number().nullable(),
  computedAt: z.string(),

  // Pull request metrics
  mergedPrs: z.number(),
  openPrs: z.number(),
  closedPrs: z.number(),
  totalPrs: z.number(),

  // Codebase size estimates
  estimatedTotalFiles: z.number(),
  estimatedTotalLoc: z.number(),

  // File type breakdown (for display)
  topFileTypes: z
    .array(
      z.object({
        type: z.string(),
        percentage: z.number(),
      }),
    )
    .nullable(), // [{ type: "TS", percentage: 65 }, ...] - by count

  topFileTypesByLoc: z
    .array(
      z.object({
        type: z.string(),
        percentage: z.number(),
      }),
    )
    .nullable(), // [{ type: "TS", percentage: 65 }, ...] - by lines of code

  // Computed metrics derivations
  prMergeRate: z.number(), // percentage of merged PRs
  avgActiveUsersPercentage: z.number(), // active users / total users
});

export type RepositoryOverview = z.infer<typeof RepositoryOverviewSchema>;

// Helper function to transform DB model to frontend model
export function transformRepositoryOverview(
  dbData: {
    first_activity: string | null;
    last_activity: string | null;
    total_users: number;
    active_users_3mo: number;
    merged_prs: number;
    open_prs: number;
    closed_prs: number;
    total_prs: number;
    estimated_total_files: number;
    estimated_total_loc: number;
    top_file_types_by_count: Array<{ extension: string; count: number }> | null;
    top_file_types_by_loc: Array<{ extension: string; loc: number }> | null;
    median_author_age_3mo_days: number | null;
    computed_at: string;
  },
  repositoryMetadata: {
    org: string;
    name: string;
  },
): RepositoryOverview {
  const prMergeRate =
    dbData.total_prs > 0
      ? Math.round((dbData.merged_prs / dbData.total_prs) * 100)
      : 0;

  const avgActiveUsersPercentage =
    dbData.total_users > 0
      ? Math.round((dbData.active_users_3mo / dbData.total_users) * 100)
      : 0;

  // Transform top file types by count to show top 5 with percentages
  const topFileTypes = dbData.top_file_types_by_count
    ? dbData.top_file_types_by_count.slice(0, 5).map((item) => {
        const totalFiles = dbData.top_file_types_by_count!.reduce(
          (sum, t) => sum + t.count,
          0,
        );
        return {
          type: item.extension.toUpperCase(),
          percentage:
            totalFiles > 0 ? Math.round((item.count / totalFiles) * 100) : 0,
        };
      })
    : [];

  // Transform top file types by LOC to show top 5 with percentages
  const topFileTypesByLoc = dbData.top_file_types_by_loc
    ? dbData.top_file_types_by_loc.slice(0, 5).map((item) => {
        const totalLoc = dbData.top_file_types_by_loc!.reduce(
          (sum, t) => sum + t.loc,
          0,
        );
        return {
          type: item.extension.toUpperCase(),
          percentage:
            totalLoc > 0 ? Math.round((item.loc / totalLoc) * 100) : 0,
        };
      })
    : [];

  return {
    repositoryName: repositoryMetadata.name,
    repositoryOrg: repositoryMetadata.org,
    fullName: `${repositoryMetadata.org}/${repositoryMetadata.name}`,
    githubUrl: `https://github.com/${repositoryMetadata.org}/${repositoryMetadata.name}`,
    firstActivity: dbData.first_activity,
    lastActivity: dbData.last_activity,
    totalUsers: dbData.total_users,
    activeUsers3mo: dbData.active_users_3mo,
    medianAuthorAge3moDays: dbData.median_author_age_3mo_days,
    computedAt: dbData.computed_at,
    mergedPrs: dbData.merged_prs,
    openPrs: dbData.open_prs,
    closedPrs: dbData.closed_prs,
    totalPrs: dbData.total_prs,
    estimatedTotalFiles: dbData.estimated_total_files,
    estimatedTotalLoc: dbData.estimated_total_loc,
    topFileTypes,
    topFileTypesByLoc,
    prMergeRate,
    avgActiveUsersPercentage,
  };
}
