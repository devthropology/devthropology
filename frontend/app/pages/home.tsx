import { Await, useRevalidator } from "react-router";
import { Suspense, useEffect } from "react";
import { z } from "zod";
import {
  ContributorAgeTrendUnit,
  ContributorInsights,
  FilesChangedUnit,
  type LanguageStats,
  LinesChangedUnit,
  MergedPRsUnit,
  MergeTimeSection,
  RepositoryHeader,
  type RepositoryHeaderData,
} from "~/components/dashboard";
import { Button } from "~/components/ui/button";
import { type DashboardData, DashboardDataSchema } from "../../../shared/models/dashboardMetrics";
import {
  type RepositoryOverview,
  RepositoryOverviewSchema,
} from "../../../shared/models/repositoryOverview";
import {
  type RepositoryContributorsMonthlyResponse,
  RepositoryContributorsMonthlyResponseSchema,
} from "../../../shared/models/repositoryContributors";
import type { UserActivityByMonth } from "~/routes/types";
import { API_URL, authenticatedFetch, type RequestLabel } from "~/config";
import { EmptyState } from "~/components/ui/EmptyState";
import { Loader2 } from "lucide-react";

const DEFAULT_MONTH_WINDOW = 18;

type HomePageData = {
  monthlyData: UserActivityByMonth[];
  dashboardData: DashboardData;
};

export type HomePageLoaderData = {
  overviewData: Promise<RepositoryOverview | null>;
  homePageData: Promise<HomePageData | null>;
};

function resolveMonthlyWindow(request: Request): string {
  const requestUrl = new URL(request.url);
  const queryValue = requestUrl.searchParams.get("monthsWindow");
  const envValue = process.env.DASHBOARD_MONTH_WINDOW;
  const rawValue = queryValue ?? envValue ?? "";
  const trimmed = rawValue.trim();

  if (trimmed && trimmed.toLowerCase() === "all") {
    return "all";
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed.toString();
  }

  return DEFAULT_MONTH_WINDOW.toString();
}

function toMonthlyData(response: RepositoryContributorsMonthlyResponse): UserActivityByMonth[] {
  return response.months.map((entry) => {
    const month = new Date(Date.UTC(entry.year, entry.month - 1, 1)).toISOString();
    return {
      month,
      new_contributors: entry.new.count,
      stopped_contributors: entry.churned.count,
      active_users: entry.active.count,
      active_details: entry.active.contributors.map(({ login, date }) => ({
        login,
        date,
      })),
      first_seen_details: entry.new.contributors.map(({ login, date }) => ({
        login,
        date,
      })),
      last_seen_details: entry.churned.contributors.map(({ login, date }) => ({
        login,
        date,
      })),
    };
  });
}

function clampPercentage(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(Math.max(value, 0), 100);
}

function buildLanguageStats(
  topFileTypes: Array<{ type: string; percentage: number }> = [],
  topFileTypesByLoc: Array<{ type: string; percentage: number }> = [],
): LanguageStats[] {
  const countMap = new Map<string, number>();
  const sizeMap = new Map<string, number>();

  topFileTypes.forEach((entry) => {
    countMap.set(entry.type, clampPercentage(entry.percentage));
  });

  topFileTypesByLoc.forEach((entry) => {
    sizeMap.set(entry.type, clampPercentage(entry.percentage));
  });

  const orderedLanguages = [
    ...topFileTypes.map((entry) => entry.type),
    ...topFileTypesByLoc.map((entry) => entry.type),
  ];
  const uniqueLanguages = Array.from(new Set(orderedLanguages));

  const merged = uniqueLanguages.map((language) => {
    const count = countMap.get(language) ?? 0;
    const size = sizeMap.get(language) ?? 0;
    return {
      languageName: language,
      countPercentage: count,
      sizePercentage: size,
    };
  });

  merged.sort((a, b) => {
    const aMax = Math.max(a.countPercentage, a.sizePercentage);
    const bMax = Math.max(b.countPercentage, b.sizePercentage);
    if (aMax === bMax) {
      // Secondary sort: favor size %, then count %, then alpha
      if (b.sizePercentage !== a.sizePercentage) {
        return b.sizePercentage - a.sizePercentage;
      }
      if (b.countPercentage !== a.countPercentage) {
        return b.countPercentage - a.countPercentage;
      }
      return a.languageName.localeCompare(b.languageName);
    }
    return bMax - aMax;
  });

  return merged.slice(0, 7);
}

function parseRequiredData<T>(label: string, data: unknown, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    console.error(`[Homepage] Invalid ${label} payload`, {
      issues: parsed.error.issues,
    });
    throw new Error(`[Homepage] Invalid ${label} payload`);
  }

  return parsed.data;
}

// Transform overview API data to RepositoryHeaderData format
function transformOverviewData(overviewData: RepositoryOverview): RepositoryHeaderData {
  const topFileTypes = overviewData.topFileTypes ?? [];
  const topFileTypesByLoc = overviewData.topFileTypesByLoc ?? [];

  return {
    name: overviewData.repositoryName,
    fullName: overviewData.fullName,
    description: "",
    githubUrl: overviewData.githubUrl,
    ownerAvatarUrl: `https://github.com/${overviewData.repositoryOrg}.png?size=200`,

    firstActivity: overviewData.firstActivity,
    lastActivity: overviewData.lastActivity,
    totalContributors: overviewData.totalUsers,
    activeContributors3mo: overviewData.activeUsers3mo,
    medianAuthorAge3moDays: overviewData.medianAuthorAge3moDays ?? null,
    totalMergedPRs: overviewData.mergedPrs,
    prMergeRate: overviewData.prMergeRate,
    openPRs: overviewData.openPrs,
    estimatedLOC: overviewData.estimatedTotalLoc,
    estimatedFiles: overviewData.estimatedTotalFiles,
    computedAt: overviewData.computedAt,
    topFileTypes,
    topFileTypesByLoc,
    languageStats: buildLanguageStats(topFileTypes, topFileTypesByLoc),
  };
}

export const meta = () => {
  return [{ title: "Home" }, { name: "description", content: "GitHub Activity Dashboard" }];
};

async function fetchRequiredJson(
  label: string,
  url: string,
  token: string,
  request: Request,
  fetchLabel?: RequestLabel,
) {
  const response = await authenticatedFetch(url, token, {
    request,
    label: fetchLabel,
  });
  if (!response.ok) {
    throw new Error(`${label} fetch failed with status: ${response.status}`);
  }

  const text = await response.text();
  if (!text) {
    throw new Error(`${label} fetch returned an empty response`);
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    console.error(`${label} returned invalid JSON`, error);
    throw new Error(`${label} returned invalid JSON`);
  }
}

export function loadHomePageData(
  request: Request,
  userToken: string,
  repositoryId: string,
): HomePageLoaderData {
  if (!repositoryId) {
    return {
      overviewData: Promise.resolve(null as RepositoryOverview | null),
      homePageData: Promise.resolve(null as HomePageData | null),
    };
  }

  const monthsWindow = resolveMonthlyWindow(request);
  const monthlyUrl = new URL(`${API_URL}/api/repository/${repositoryId}/contributors/monthly`);
  monthlyUrl.searchParams.set("months", monthsWindow);

  const dashboardUrl = new URL(`${API_URL}/api/repository/${repositoryId}/dashboard`);
  dashboardUrl.searchParams.set("months", monthsWindow);

  const overviewData = fetchRequiredJson(
    "overview",
    `${API_URL}/api/repository/${repositoryId}/overview`,
    userToken,
    request,
    "home.overview",
  ).then((data) => parseRequiredData("overview", data, RepositoryOverviewSchema));

  const homePageData = Promise.all([
    fetchRequiredJson("monthly", monthlyUrl.toString(), userToken, request, "home.monthly").then(
      (data) =>
        toMonthlyData(
          parseRequiredData("monthly data", data, RepositoryContributorsMonthlyResponseSchema),
        ),
    ),
    fetchRequiredJson(
      "dashboard",
      dashboardUrl.toString(),
      userToken,
      request,
      "home.dashboard",
    ).then((data) => parseRequiredData("dashboard data", data, DashboardDataSchema)),
  ]).then(([monthlyData, dashboardData]) => ({
    monthlyData,
    dashboardData,
  }));

  return {
    overviewData,
    homePageData,
  };
}

function LoadingState() {
  return (
    <div className="flex justify-center items-center h-32">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function ErrorStateWithRetry({ message, context }: { message: string; context: string }) {
  const revalidator = useRevalidator();
  const isRetrying = revalidator.state === "loading";

  useEffect(() => {
    console.error(`[Dashboard] ${context} failed; rendering error state (manual retry available)`);
  }, [context]);

  const handleRetry = () => {
    void revalidator.revalidate();
  };

  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-muted/20 px-4 py-6">
      <EmptyState message={message} className="p-0" />
      <div className="flex items-center gap-2">
        <Button variant="default" size="sm" onClick={handleRetry} disabled={isRetrying}>
          {isRetrying ? "Retrying..." : "Retry"}
        </Button>
      </div>
    </div>
  );
}

export function HomePageContent({ loaderData }: { loaderData: HomePageLoaderData }) {
  const { overviewData, homePageData } = loaderData;

  return (
    <div className="flex-1 flex flex-col w-full gap-12">
      <Suspense
        fallback={
          <>
            <div className="w-full">
              <EmptyState message="Loading repository overview..." />
            </div>
            <LoadingState />
          </>
        }
      >
        <Await
          resolve={overviewData}
          errorElement={
            <ErrorStateWithRetry
              context="homepage overview promise rejected"
              message="Unable to load repository overview. Please check your connection and try again."
            />
          }
        >
          {(resolvedOverviewData) => {
            if (!resolvedOverviewData) {
              return (
                <div className="w-full">
                  <EmptyState message="Select a repository to load homepage data." />
                </div>
              );
            }

            const repositoryHeaderData = transformOverviewData(resolvedOverviewData);

            return (
              <>
                <div className="w-full">
                  <RepositoryHeader data={repositoryHeaderData} />
                </div>

                <Suspense fallback={<LoadingState />}>
                  <Await
                    resolve={homePageData}
                    errorElement={
                      <ErrorStateWithRetry
                        context="homepage secondary data promise rejected"
                        message="Unable to load the rest of the homepage data. Please check your connection and try again."
                      />
                    }
                  >
                    {(resolvedHomePageData) => {
                      if (!resolvedHomePageData) {
                        return (
                          <ErrorStateWithRetry
                            context="homepage secondary data missing"
                            message="Unable to load the rest of the homepage data. Please check your connection and try again."
                          />
                        );
                      }

                      return (
                        <>
                          <div className="w-full">
                            <ContributorInsights monthlyData={resolvedHomePageData.monthlyData} />
                          </div>

                          <div className="w-full space-y-8">
                            <MergeTimeSection
                              current7d={resolvedHomePageData.dashboardData.volumeMetrics.current7d}
                              current30d={
                                resolvedHomePageData.dashboardData.volumeMetrics.current30d
                              }
                              weeklyTrends={
                                resolvedHomePageData.dashboardData.volumeMetrics.weeklyTrends
                              }
                            />
                            <MergedPRsUnit
                              current7d={resolvedHomePageData.dashboardData.volumeMetrics.current7d}
                              current30d={
                                resolvedHomePageData.dashboardData.volumeMetrics.current30d
                              }
                              weeklyTrends={
                                resolvedHomePageData.dashboardData.volumeMetrics.weeklyTrends
                              }
                            />
                            <ContributorAgeTrendUnit
                              current7d={resolvedHomePageData.dashboardData.volumeMetrics.current7d}
                              current30d={
                                resolvedHomePageData.dashboardData.volumeMetrics.current30d
                              }
                              weeklyTrends={
                                resolvedHomePageData.dashboardData.volumeMetrics.weeklyTrends
                              }
                            />

                            <LinesChangedUnit
                              current7d={resolvedHomePageData.dashboardData.volumeMetrics.current7d}
                              current30d={
                                resolvedHomePageData.dashboardData.volumeMetrics.current30d
                              }
                              weeklyTrends={
                                resolvedHomePageData.dashboardData.volumeMetrics.weeklyTrends
                              }
                            />

                            <FilesChangedUnit
                              current7d={resolvedHomePageData.dashboardData.volumeMetrics.current7d}
                              current30d={
                                resolvedHomePageData.dashboardData.volumeMetrics.current30d
                              }
                              weeklyTrends={
                                resolvedHomePageData.dashboardData.volumeMetrics.weeklyTrends
                              }
                            />
                          </div>
                        </>
                      );
                    }}
                  </Await>
                </Suspense>
              </>
            );
          }}
        </Await>
      </Suspense>
    </div>
  );
}

export default function Index({ loaderData }: { loaderData: HomePageLoaderData }) {
  return <HomePageContent loaderData={loaderData} />;
}
