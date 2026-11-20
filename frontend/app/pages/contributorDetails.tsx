import {
  isRouteErrorResponse,
  Link,
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigation,
  useRouteError,
} from "react-router";
import { type MetaFunction } from "react-router";
import { Button } from "../components/ui/button";
import { EmptyState } from "../components/ui/EmptyState";
import { ArrowLeft } from "lucide-react";
import { API_URL, authenticatedFetch } from "../config";
import { DataTable } from "../components/ui/data-table";
import { createColumns } from "../components/user-stats/columns";
import { createColumns as createIssueColumns } from "../components/user-issue-reviews/columns";
import type { UserStatsForUi } from "../routes/types";
import type {
  ComputedUserMetrics,
  ComputedUserMetricValue,
  UserMetricKey,
  UserMonthlyMetrics,
  UserPullStats,
  UserReviewStats,
} from "../../../shared/models";
import { USER_METRIC_KEYS, USER_METRIC_PERIODS } from "../../../shared/models";
import { UserMonthlyMetricsChart } from "../components/user-stats/UserMonthlyMetricsChart";
import { formatMetricValue } from "../utils/numberFormat";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PullEntry, ReviewEntry } from "../../../shared/models";
import { differenceInCalendarDays } from "date-fns";
import { useCurrentRepoRef } from "../utils/repositoryRoutes";

const ACTIVITY_TABLE_MAX_HEIGHT = "min(62vh, 680px)";

type GithubUser = {
  login: string;
  name: string | null;
  avatar_url: string;
  company: string | null;
  location: string | null;
  created_at: string;
  html_url: string;
};

type LoaderData = {
  userName: string;
  githubUser: GithubUser | null;
  githubUserError: string | null;
  userStats: UserStatsForUi | null;
  pullStats: UserPullStats | null;
  reviewStats: UserReviewStats | null;
  userMetrics: ComputedUserMetrics;
};

function hasRepositoryActivity(userStats: UserStatsForUi | null): boolean {
  if (!userStats) {
    return false;
  }

  return Boolean(
    userStats.first_seen_timestamp ||
    userStats.last_seen_timestamp ||
    userStats.issue_count > 0 ||
    userStats.pull_request_count > 0 ||
    userStats.merged_pull_count > 0 ||
    userStats.open_pull_count > 0,
  );
}

function isGithubUser(value: unknown): value is GithubUser {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<GithubUser>;
  return (
    typeof candidate.login === "string" &&
    typeof candidate.avatar_url === "string" &&
    typeof candidate.created_at === "string" &&
    typeof candidate.html_url === "string" &&
    (candidate.name === null || typeof candidate.name === "string") &&
    (candidate.company === null || typeof candidate.company === "string") &&
    (candidate.location === null || typeof candidate.location === "string")
  );
}

export const meta: MetaFunction = () => {
  return [
    { title: "Contributor Details" },
    { name: "description", content: "GitHub Contributor Activity Details" },
  ];
};

export async function loadContributorDetailData(
  request: Request,
  userToken: string,
  repositoryId: string,
  userName: string,
): Promise<LoaderData> {
  if (!repositoryId) {
    throw new Error("Repository not selected");
  }

  const emptyComputedMetrics: ComputedUserMetrics = { metrics: {} };

  try {
    const logContext = `[userLoader repo=${repositoryId} user=${userName}]`;

    async function fetchJsonWithLogging<T>(
      label: string,
      requestFn: () => Promise<Response>,
    ): Promise<T | null> {
      try {
        const response = await requestFn();
        const rawBody = await response.text();

        if (!response.ok) {
          console.error(
            `${logContext} ${label} request failed`,
            response.status,
            response.statusText,
            rawBody.slice(0, 200),
          );
          return null;
        }

        try {
          return JSON.parse(rawBody) as T;
        } catch (parseError) {
          console.error(`${logContext} ${label} parse error`, parseError, rawBody.slice(0, 200));
          return null;
        }
      } catch (error) {
        console.error(`${logContext} ${label} request error`, error);
        return null;
      }
    }

    let githubUserError: string | null = null;
    let githubUserStatus: number | null = null;
    const githubUserPromise = authenticatedFetch(
      `${API_URL}/api/github/users/${userName}`,
      userToken,
      { request },
    )
      .then(async (response) => {
        githubUserStatus = response.status;
        const rawBody = await response.text();
        let parsedBody: unknown;

        try {
          parsedBody = rawBody ? JSON.parse(rawBody) : null;
        } catch (parseError) {
          if (!response.ok) {
            githubUserError = `GitHub user request failed with status ${response.status}`;
            console.error(
              `${logContext} GitHub user fetch failed (unparseable error body)`,
              response.status,
              response.statusText,
              rawBody.slice(0, 200),
            );
            return null;
          }

          githubUserError = "Unable to parse GitHub user response";
          console.error(
            `${logContext} GitHub user response parse error`,
            parseError,
            rawBody.slice(0, 200),
          );
          return null;
        }

        if (!response.ok) {
          const message =
            parsedBody &&
            typeof parsedBody === "object" &&
            typeof (parsedBody as { error?: unknown }).error === "string"
              ? (parsedBody as { error: string }).error
              : `GitHub user request failed with status ${response.status}`;
          githubUserError = message;
          if (response.status === 404) {
            return null;
          }
          console.error(
            `${logContext} GitHub user fetch failed`,
            response.status,
            response.statusText,
            rawBody.slice(0, 200),
          );
          return null;
        }

        if (isGithubUser(parsedBody)) {
          return parsedBody;
        }

        githubUserError = "Unable to parse GitHub user response";
        console.error(
          `${logContext} GitHub user response validation error`,
          parsedBody,
          rawBody.slice(0, 200),
        );
        return null;
      })
      .catch((fetchError) => {
        githubUserError = "Unable to reach GitHub user endpoint";
        console.error(`${logContext} GitHub user request error`, fetchError);
        return null;
      });

    const [githubUser, userStats]: [GithubUser | null, UserStatsForUi | null] = await Promise.all([
      githubUserPromise,
      fetchJsonWithLogging<UserStatsForUi>("user stats", () =>
        authenticatedFetch(
          `${API_URL}/api/repository/${repositoryId}/users/${userName}`,
          userToken,
          { request },
        ),
      ),
    ]);

    if (githubUserStatus === 404) {
      throw new Response("GitHub user not found", { status: 404, statusText: "Not Found" });
    }

    if (!userStats) {
      console.error(`${logContext} user stats unavailable`);
      return {
        userName,
        githubUser,
        githubUserError,
        userStats: null,
        pullStats: null,
        reviewStats: null,
        userMetrics: emptyComputedMetrics,
      };
    }

    if (!hasRepositoryActivity(userStats)) {
      return {
        userName,
        githubUser,
        githubUserError,
        userStats,
        pullStats: null,
        reviewStats: null,
        userMetrics: emptyComputedMetrics,
      };
    }

    const [pullStats, reviewStats, computedMetrics]: [
      UserPullStats | null,
      UserReviewStats | null,
      ComputedUserMetrics | null,
    ] = await Promise.all([
      fetchJsonWithLogging<UserPullStats>("pull stats", () =>
        authenticatedFetch(
          `${API_URL}/api/repository/${repositoryId}/users/${userName}/stats/pulls?limit=25`,
          userToken,
          { request },
        ),
      ),
      fetchJsonWithLogging<UserReviewStats>("review stats", () =>
        authenticatedFetch(
          `${API_URL}/api/repository/${repositoryId}/users/${userName}/stats/reviews?limit=25`,
          userToken,
          { request },
        ),
      ),
      fetchJsonWithLogging<ComputedUserMetrics>("computed stats", () =>
        authenticatedFetch(
          `${API_URL}/api/repository/${repositoryId}/users/${userName}/stats/metrics`,
          userToken,
          { request },
        ),
      ),
    ]);

    return {
      userName,
      githubUser,
      githubUserError,
      userStats,
      pullStats,
      reviewStats,
      userMetrics: computedMetrics ?? emptyComputedMetrics,
    };
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }

    console.error("Error loading user data:", error);
    return {
      userName,
      githubUser: null,
      userStats: null,
      pullStats: null,
      reviewStats: null,
      githubUserError: error instanceof Error ? error.message : "Unknown error loading user",
      userMetrics: emptyComputedMetrics,
    };
  }
}

function Header({ backPath }: { backPath: string }) {
  return (
    <div className="mb-8">
      <Link to={backPath}>
        <Button
          variant="ghost"
          className="group flex items-center gap-2 border border-gray-700 bg-transparent px-3 py-2 text-sm font-medium text-gray-300 shadow-none hover:bg-gray-800/60 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          Back to Contributors
        </Button>
      </Link>
    </div>
  );
}

function formatDuration(days: number): string {
  if (days <= 0) {
    return "0 days";
  }

  const years = Math.floor(days / 365);
  const months = Math.floor((days % 365) / 30);
  const remainingDays = days % 30;

  const parts = [];
  if (years > 0) parts.push(`${years} ${years === 1 ? "year" : "years"}`);
  if (months > 0) {
    parts.push(`${months} ${months === 1 ? "month" : "months"}`);
  }
  if (remainingDays > 0) {
    parts.push(`${remainingDays} ${remainingDays === 1 ? "day" : "days"}`);
  }

  return parts.join(", ");
}

function getRelativeDayLabel(days: number): string {
  if (days <= 0) {
    return "today";
  }

  if (days === 1) {
    return "yesterday";
  }

  return `${formatDuration(days)} ago`;
}

function ProfileHeader({
  user,
  githubUserError,
  firstSeen,
  lastSeen,
  userPosition,
  totalUniqueUsers,
  userStats,
  hasRepositoryActivity,
}: {
  user: GithubUser | null;
  githubUserError: string | null;
  firstSeen: Date | null;
  lastSeen: Date | null;
  userPosition: number;
  totalUniqueUsers: number;
  userStats: UserStatsForUi | null;
  hasRepositoryActivity: boolean;
}) {
  const memberSince = user ? new Date(user.created_at) : null;
  const now = new Date();
  const firstSeenDays = firstSeen ? Math.max(0, differenceInCalendarDays(now, firstSeen)) : null;
  const lastSeenDays = lastSeen ? Math.max(0, differenceInCalendarDays(now, lastSeen)) : null;

  function getOrdinalSuffix(n: number): string {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-5">
        {user && (
          <img
            src={user.avatar_url}
            alt={`${user.login}'s profile`}
            className="h-20 w-20 flex-shrink-0 rounded-full border border-gray-800 object-cover shadow-lg sm:h-24 sm:w-24"
          />
        )}
        <div className="flex-1">
          {user ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <h1 className="text-2xl font-bold leading-tight text-white">
                  {user.name || user.login}
                </h1>
                <a
                  href={`https://github.com/${user.login}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-400 hover:text-blue-300"
                >
                  @{user.login}
                </a>
              </div>
              {user.location && <p className="text-gray-300">Location: {user.location}</p>}
              {user.company && <p className="text-gray-300">Company: {user.company}</p>}
              {memberSince && (
                <p className="text-gray-300">
                  GitHub member since: {memberSince.toLocaleDateString()}
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-yellow-700 bg-yellow-900 p-4 text-yellow-100">
              <p className="font-semibold">GitHub profile unavailable</p>
              <p className="text-sm">
                {githubUserError ?? "We couldn't load this GitHub profile right now."}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-gray-700 pt-4">
        <h2 className="text-xl font-semibold text-white mb-2">
          {hasRepositoryActivity ? "Repository Activity" : "No Repository Activity"}
        </h2>
        <div className="space-y-2">
          {firstSeen && firstSeenDays !== null && (
            <p className="text-gray-300">
              First Seen: {firstSeen.toLocaleDateString()} ({getRelativeDayLabel(firstSeenDays)})
            </p>
          )}
          {lastSeen && lastSeenDays !== null && (
            <p className="text-gray-300">
              Last Seen: {lastSeen.toLocaleDateString()} ({getRelativeDayLabel(lastSeenDays)})
            </p>
          )}
          {userPosition > 0 && (
            <p className="text-gray-300">
              {userPosition.toLocaleString()}
              {getOrdinalSuffix(userPosition)} contributor to join (
              {totalUniqueUsers.toLocaleString()} total)
            </p>
          )}
          {!hasRepositoryActivity ? null : userStats ? (
            <>
              <p className="text-gray-300">
                PR Merge Rate:{" "}
                {userStats.pull_request_count > 0
                  ? ((userStats.merged_pull_count / userStats.pull_request_count) * 100).toFixed(1)
                  : 0}
                % ({userStats.merged_pull_count.toLocaleString()} of{" "}
                {userStats.pull_request_count.toLocaleString()})
              </p>
              {userStats.issue_count > 0 && (
                <p className="text-gray-300">
                  Issues Created: {userStats.issue_count.toLocaleString()}
                </p>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const METRIC_DISPLAY_CONFIG = [
  { key: USER_METRIC_KEYS.PRS_MERGED, label: "Merged PRs" },
  { key: USER_METRIC_KEYS.LINES_MODIFIED, label: "Lines Modified" },
  { key: USER_METRIC_KEYS.PRS_REVIEWED, label: "PRs Reviewed" },
  { key: USER_METRIC_KEYS.PR_COMMENTS_ADDED, label: "PR Comments" },
] as const;

const METRIC_PERIOD_COLUMNS = [
  { key: USER_METRIC_PERIODS.ONE_MONTH, label: "1 Month" },
  { key: USER_METRIC_PERIODS.THREE_MONTHS, label: "3 Months" },
  { key: USER_METRIC_PERIODS.ONE_YEAR, label: "1 Year" },
  { key: USER_METRIC_PERIODS.ALL_TIME, label: "All Time" },
] as const;

function hasDisplayableMetric(metrics: ComputedUserMetrics["metrics"]): boolean {
  return METRIC_DISPLAY_CONFIG.some((config) => {
    const entry = metrics[config.key];
    if (!entry) return false;
    return METRIC_PERIOD_COLUMNS.some((period) => entry[period.key]);
  });
}

function getDefaultMetric(metrics: ComputedUserMetrics["metrics"]): UserMetricKey {
  for (const config of METRIC_DISPLAY_CONFIG) {
    const entry = metrics[config.key];
    if (!entry) continue;
    const allTime = entry[USER_METRIC_PERIODS.ALL_TIME];
    if (allTime && allTime.value > 0) return config.key as UserMetricKey;
  }
  return USER_METRIC_KEYS.PRS_MERGED as UserMetricKey;
}

function UserMetricsTable({
  metrics,
  selectedMetric,
  onSelectMetric,
}: {
  metrics: ComputedUserMetrics;
  selectedMetric: UserMetricKey;
  onSelectMetric: (key: UserMetricKey) => void;
}) {
  return (
    <div className="w-full">
      <div className="overflow-x-auto rounded-lg border border-gray-800 bg-gray-900/60">
        <table className="min-w-full divide-y divide-gray-800">
          <thead className="bg-gray-800/70">
            <tr>
              <th
                scope="col"
                className="py-2.5 pl-3 pr-2 text-left text-xs font-semibold text-gray-200 sm:py-3 sm:pl-4 sm:pr-3 sm:text-base"
              >
                Metric
              </th>
              {METRIC_PERIOD_COLUMNS.map((column) => (
                <th
                  scope="col"
                  key={column.key}
                  className="px-2 py-2.5 text-right text-xs font-semibold text-gray-200 sm:px-4 sm:py-3 sm:text-base"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {METRIC_DISPLAY_CONFIG.map((config) => {
              const row = metrics.metrics[config.key];
              if (!row) {
                return null;
              }
              const hasValues = METRIC_PERIOD_COLUMNS.some((column) => row[column.key]);
              if (!hasValues) {
                return null;
              }

              const isSelected = selectedMetric === config.key;

              return (
                <tr
                  key={config.key}
                  onClick={() => onSelectMetric(config.key as UserMetricKey)}
                  className={`cursor-pointer transition-colors duration-150 ${
                    isSelected
                      ? "bg-blue-900/40 border-l-2 border-l-blue-400"
                      : "odd:bg-gray-900 even:bg-gray-900/70 hover:bg-gray-800/80"
                  }`}
                >
                  <th
                    scope="row"
                    className={`py-2.5 pl-3 pr-2 text-left text-xs font-medium sm:py-3 sm:pl-4 sm:pr-3 sm:text-base ${
                      isSelected ? "text-blue-200" : "text-gray-100"
                    }`}
                  >
                    {config.label}
                  </th>
                  {METRIC_PERIOD_COLUMNS.map((column) => (
                    <td
                      key={column.key}
                      className={`px-2 py-2.5 text-right text-xs sm:px-4 sm:py-3 sm:text-base ${
                        isSelected ? "text-blue-100" : "text-gray-100"
                      }`}
                    >
                      {formatMetricCell(row[column.key])}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatMetricCell(metric?: ComputedUserMetricValue) {
  if (!metric) {
    return "-";
  }

  const valueText = formatMetricValue(metric.value);
  if (metric.rank === null || metric.rank === undefined) {
    return valueText;
  }

  const rankText = metric.rank.toLocaleString();
  return (
    <div className="flex flex-col items-end">
      <span className="leading-none">{valueText}</span>
      <span className="text-[10px] opacity-60 mt-1 font-normal leading-none sm:text-xs">
        (#{rankText})
      </span>
    </div>
  );
}

type TabOption = "created" | "reviewed";

function SegmentedControl({
  activeTab,
  onTabChange,
}: {
  activeTab: TabOption;
  onTabChange: (tab: TabOption) => void;
}) {
  return (
    <div className="flex gap-1 p-1 bg-gray-800 rounded-lg w-fit">
      <button
        onClick={() => onTabChange("created")}
        className={`px-6 py-2 rounded-md font-medium transition-all duration-200 ${
          activeTab === "created"
            ? "bg-blue-600 text-white shadow-md"
            : "text-gray-300 hover:text-white hover:bg-gray-700"
        }`}
      >
        Created
      </button>
      <button
        onClick={() => onTabChange("reviewed")}
        className={`px-6 py-2 rounded-md font-medium transition-all duration-200 ${
          activeTab === "reviewed"
            ? "bg-blue-600 text-white shadow-md"
            : "text-gray-300 hover:text-white hover:bg-gray-700"
        }`}
      >
        Reviewed
      </button>
    </div>
  );
}

const PAGE_SIZE = 25;

export function ContributorDetailPage({
  loaderData,
  buildBackPath,
}: {
  loaderData: LoaderData;
  buildBackPath: () => string;
}) {
  const { userName, githubUser, githubUserError, userStats, pullStats, reviewStats, userMetrics } =
    loaderData;
  const location = useLocation();
  const navigation = useNavigation();
  const isRouteTransition =
    navigation.state === "loading" && navigation.location?.pathname !== location.pathname;
  const repositoryHasActivity = hasRepositoryActivity(userStats);
  const hasMetricTableRows = hasDisplayableMetric(userMetrics.metrics);
  const [activeTab, setActiveTab] = useState<TabOption>(
    (pullStats?.recentPulls.length ?? 0) === 0 && (reviewStats?.recentReviews.length ?? 0) > 0
      ? "reviewed"
      : "created",
  );
  const [selectedMetric, setSelectedMetric] = useState<UserMetricKey>(
    getDefaultMetric(userMetrics.metrics),
  );
  const repoRef = useCurrentRepoRef();
  const pullColumns = useMemo(
    () =>
      pullStats
        ? createColumns({
            repoOwner: pullStats.repoOwner,
            repoName: pullStats.repoName,
          })
        : null,
    [pullStats],
  );
  const reviewColumns = useMemo(
    () =>
      reviewStats
        ? createIssueColumns({
            repoOwner: reviewStats.repoOwner,
            repoName: reviewStats.repoName,
            repoRef: repoRef ?? undefined,
          })
        : null,
    [repoRef, reviewStats],
  );

  // Async fetch for monthly metrics chart
  const monthlyMetricsFetcher = useFetcher<UserMonthlyMetrics>();
  const monthlyMetricsLoaded = useRef(false);

  // Infinite scroll state for pulls
  const [allPulls, setAllPulls] = useState<PullEntry[]>(pullStats?.recentPulls ?? []);
  const [pullsHasMore, setPullsHasMore] = useState(
    (pullStats?.recentPulls.length ?? 0) >= PAGE_SIZE,
  );
  const pullsOffsetRef = useRef(pullStats?.recentPulls.length ?? 0);
  const pullsFetcher = useFetcher<{ recentPulls?: PullEntry[] }>();

  // Infinite scroll state for reviews
  const [allReviews, setAllReviews] = useState<ReviewEntry[]>(reviewStats?.recentReviews ?? []);
  const [reviewsHasMore, setReviewsHasMore] = useState(
    (reviewStats?.recentReviews.length ?? 0) >= PAGE_SIZE,
  );
  const reviewsOffsetRef = useRef(reviewStats?.recentReviews.length ?? 0);
  const reviewsFetcher = useFetcher<{ recentReviews?: ReviewEntry[] }>();

  // Reset accumulated data when loader data changes (e.g. navigating to a different user or repo)
  useEffect(() => {
    setAllPulls(pullStats?.recentPulls ?? []);
    setPullsHasMore((pullStats?.recentPulls.length ?? 0) >= PAGE_SIZE);
    pullsOffsetRef.current = pullStats?.recentPulls.length ?? 0;
  }, [pullStats]);

  useEffect(() => {
    setAllReviews(reviewStats?.recentReviews ?? []);
    setReviewsHasMore((reviewStats?.recentReviews.length ?? 0) >= PAGE_SIZE);
    reviewsOffsetRef.current = reviewStats?.recentReviews.length ?? 0;
  }, [reviewStats]);

  // Reset selected metric and active tab when metrics/data change (repo or user switch)
  useEffect(() => {
    setSelectedMetric(getDefaultMetric(userMetrics.metrics));
  }, [userMetrics]);

  useEffect(() => {
    setActiveTab(
      (pullStats?.recentPulls.length ?? 0) === 0 && (reviewStats?.recentReviews.length ?? 0) > 0
        ? "reviewed"
        : "created",
    );
  }, [pullStats, reviewStats]);

  // Append new pulls when fetcher returns data
  useEffect(() => {
    if (pullsFetcher.data?.recentPulls) {
      const newPulls = pullsFetcher.data.recentPulls;
      setAllPulls((prev) => [...prev, ...newPulls]);
      pullsOffsetRef.current += newPulls.length;
      if (newPulls.length < PAGE_SIZE) {
        setPullsHasMore(false);
      }
    }
  }, [pullsFetcher.data]);

  // Load monthly metrics asynchronously; re-fetch when user or repository changes
  // (userMetrics comes from the loader and changes on both user and repo switches)
  useEffect(() => {
    monthlyMetricsLoaded.current = false;
  }, [userName, userMetrics]);

  useEffect(() => {
    if (repoRef && hasMetricTableRows && !monthlyMetricsLoaded.current) {
      monthlyMetricsLoaded.current = true;
      const repositoryId = encodeURIComponent(repoRef);
      void monthlyMetricsFetcher.load(
        `/app/api/users/${userName}/stats/monthly-metrics?repositoryId=${repositoryId}`,
      );
    }
  }, [repoRef, userName, hasMetricTableRows, userMetrics]);

  // Append new reviews when fetcher returns data
  useEffect(() => {
    if (reviewsFetcher.data?.recentReviews) {
      const newReviews = reviewsFetcher.data.recentReviews;
      setAllReviews((prev) => [...prev, ...newReviews]);
      reviewsOffsetRef.current += newReviews.length;
      if (newReviews.length < PAGE_SIZE) {
        setReviewsHasMore(false);
      }
    }
  }, [reviewsFetcher.data]);

  const loadMorePulls = useCallback(() => {
    if (!repoRef || pullsFetcher.state !== "idle" || !pullsHasMore) return;
    const repositoryId = encodeURIComponent(repoRef);
    void pullsFetcher.load(
      `/app/api/users/${userName}/stats/pulls?repositoryId=${repositoryId}&limit=${PAGE_SIZE}&offset=${pullsOffsetRef.current}`,
    );
  }, [pullsFetcher, pullsHasMore, repoRef, userName]);

  const loadMoreReviews = useCallback(() => {
    if (!repoRef || reviewsFetcher.state !== "idle" || !reviewsHasMore) return;
    const repositoryId = encodeURIComponent(repoRef);
    void reviewsFetcher.load(
      `/app/api/users/${userName}/stats/reviews?repositoryId=${repositoryId}&limit=${PAGE_SIZE}&offset=${reviewsOffsetRef.current}`,
    );
  }, [reviewsFetcher, repoRef, reviewsHasMore, userName]);

  if (!userStats) {
    return (
      <div className="flex-1 font-sans text-white">
        <Header backPath={buildBackPath()} />
        <EmptyState message="Unable to load user data. Please check your connection and try again." />
      </div>
    );
  }

  const firstSeen = userStats.first_seen_timestamp
    ? new Date(userStats.first_seen_timestamp)
    : null;
  const lastSeen = userStats.last_seen_timestamp ? new Date(userStats.last_seen_timestamp) : null;

  return (
    <div className="flex-1 min-w-0 flex flex-col font-sans text-white">
      <Header backPath={buildBackPath()} />
      <ProfileHeader
        user={githubUser}
        githubUserError={githubUserError}
        firstSeen={firstSeen}
        lastSeen={lastSeen}
        userPosition={userStats.user_position}
        totalUniqueUsers={userStats.total_unique_users}
        userStats={userStats}
        hasRepositoryActivity={repositoryHasActivity}
      />

      {repositoryHasActivity && hasMetricTableRows && (
        <div className="mt-8">
          <h2 className="text-xl font-semibold mb-4">User Stats</h2>
          {!isRouteTransition && navigation.state === "loading" ? (
            <div className="flex justify-center items-center h-32">
              <div className="text-gray-300">Loading computed metrics...</div>
            </div>
          ) : (
            <div className="flex flex-col xl:flex-row gap-6">
              <div className="xl:w-[55%] shrink-0">
                <UserMetricsTable
                  metrics={userMetrics}
                  selectedMetric={selectedMetric}
                  onSelectMetric={setSelectedMetric}
                />
              </div>
              <div className="xl:w-[45%] flex flex-col rounded-lg border border-gray-800 bg-gray-900/60 p-4">
                <div className="h-64 sm:h-72 xl:h-auto xl:flex-1">
                  <UserMonthlyMetricsChart
                    data={monthlyMetricsFetcher.data ?? null}
                    selectedMetric={selectedMetric}
                    isLoading={monthlyMetricsFetcher.state !== "idle"}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {repositoryHasActivity && (
        <div className="mt-8 flex-1 min-w-0 flex flex-col min-h-0">
          <div className="flex items-center gap-6 mb-5 flex-shrink-0">
            <h2 className="text-xl font-semibold">Pull Request Activity</h2>
            <SegmentedControl activeTab={activeTab} onTabChange={setActiveTab} />
          </div>
          <div className="flex-1 min-h-0 min-w-0">
            {!isRouteTransition && navigation.state === "loading" ? (
              <div className="flex justify-center items-center h-32">
                <div className="text-gray-300">
                  {activeTab === "created"
                    ? "Loading pull requests..."
                    : "Loading issue reviews..."}
                </div>
              </div>
            ) : activeTab === "created" ? (
              allPulls.length > 0 && pullStats ? (
                <DataTable
                  columns={pullColumns ?? []}
                  data={allPulls}
                  maxHeight={ACTIVITY_TABLE_MAX_HEIGHT}
                  showCustomHorizontalScrollbar
                  onScrollNearEnd={pullsHasMore ? loadMorePulls : undefined}
                  isLoadingMore={pullsFetcher.state !== "idle"}
                />
              ) : (
                <div className="flex justify-center items-center h-32">
                  <div className="text-gray-300">No pull requests found</div>
                </div>
              )
            ) : allReviews.length > 0 && reviewStats ? (
              <DataTable
                columns={reviewColumns ?? []}
                data={allReviews}
                maxHeight={ACTIVITY_TABLE_MAX_HEIGHT}
                showCustomHorizontalScrollbar
                onScrollNearEnd={reviewsHasMore ? loadMoreReviews : undefined}
                isLoadingMore={reviewsFetcher.state !== "idle"}
              />
            ) : (
              <div className="flex justify-center items-center h-32">
                <div className="text-gray-300">No issue reviews found</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ContributorDetailErrorBoundary({ backPath }: { backPath: string }) {
  const error = useRouteError();

  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <div className="flex-1 min-w-0 flex flex-col font-sans text-white">
        <Header backPath={backPath} />
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <div className="w-full max-w-2xl rounded-lg border border-white/10 bg-slate-950/70 px-8 py-12 text-center">
            <div className="text-6xl font-black tracking-tight text-white">404</div>
            <h1 className="mt-4 text-2xl font-semibold text-white">GitHub user not found</h1>
            <p className="mt-3 text-gray-300">
              This contributor page doesn&apos;t exist because the GitHub username couldn&apos;t be
              found.
            </p>
          </div>
        </div>
      </div>
    );
  }

  throw error;
}

export { ContributorDetailErrorBoundary as ErrorBoundary };

export function ContributorDetailsRoute({ backPath }: { backPath: string }) {
  const loaderData = useLoaderData<LoaderData>();

  return <ContributorDetailPage loaderData={loaderData} buildBackPath={() => backPath} />;
}
