import {
  Await,
  useAsyncError,
  useLocation,
  useNavigate,
  useNavigation,
  useRevalidator,
  useSearchParams,
} from "react-router";
import { createColumns } from "~/components/reviewer-stats/columns";
import type { UserActivityOverview } from "../routes/types";
import type { ReviewerStats, ReviewerStatsResponse } from "../../../shared/models/reviewerStats";
import type { Team } from "../../../shared/models/team";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataTable } from "../components/ui/data-table";
import { EnhancedDateRangePicker } from "../components/ui/EnhancedDateRangePicker";
import { EmptyState } from "../components/ui/EmptyState";
import { ExportCsvButton } from "../components/ui/ExportCsvButton";
import { buildCsv, buildReportCsvFilename, downloadCsv } from "../utils/csvExport";
import { REVIEWER_CSV_COLUMNS } from "../utils/reportCsvColumns";
import { Check, ChevronDown, Loader2, X } from "lucide-react";
import { ReportUserFilter } from "../components/reports/ReportUserFilter";
import { ReportTiersToggle } from "../components/reports/ReportTiersToggle";
import { API_URL, authenticatedFetch } from "~/config";
import type { DateRange } from "react-day-picker";
import {
  formatDateForQuery,
  getDateRangeFromSearchParams,
  isSameDateRange,
} from "../utils/dateRange";
import { Badge } from "../components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { cn } from "../lib/utils";
import { rankCommandMatch } from "../utils/commandRanking";
import { useSpinDelay } from "../utils/useSpinDelay";
import { loadReportTeamFilterData, parseCommaSeparatedParam } from "../utils/reportTeamFilters";

const MAX_VISIBLE_CHIPS = 8;
const REPORTS_TABLE_MAX_HEIGHT = "100%";

export type ReviewerReportsLoaderData = {
  stats: Promise<ReviewerStatsResponse>;
  users: string[];
  teams: Team[];
  selectedTeamMembers: string[];
  orgThresholds: Promise<ReviewerStatsResponse | null> | null;
  repositoryId: string;
};

export const handle = {
  appLayoutMode: "fixed",
} as const;

export const meta = () => [
  { title: "Reviewer Reports" },
  { name: "description", content: "GitHub Reviewer Reports" },
];

function createEmptyReviewerReportsLoaderData(repositoryId = ""): ReviewerReportsLoaderData {
  return {
    stats: Promise.resolve({ reviewers: [], thresholds: [] } as ReviewerStatsResponse),
    users: [],
    teams: [],
    selectedTeamMembers: [],
    orgThresholds: null,
    repositoryId,
  };
}

export async function loadReviewerReportsData(
  request: Request,
  userToken: string,
  repositoryId: string,
): Promise<ReviewerReportsLoaderData> {
  if (!repositoryId) {
    return createEmptyReviewerReportsLoaderData();
  }

  const requestUrl = new URL(request.url);
  const reviewerFilters = parseCommaSeparatedParam(requestUrl.searchParams.get("users"));
  const selectedTeamSlugs = parseCommaSeparatedParam(requestUrl.searchParams.get("teams"));
  const { from: startDate, to: endDate } = getDateRangeFromSearchParams(requestUrl.searchParams);

  const url = new URL(`${API_URL}/api/repository/${repositoryId}/reports/reviewers`);
  url.searchParams.set("startDate", formatDateForQuery(startDate));
  url.searchParams.set("endDate", formatDateForQuery(endDate));
  if (reviewerFilters.length) {
    url.searchParams.set("users", reviewerFilters.join(","));
  }
  if (selectedTeamSlugs.length) {
    url.searchParams.set("teams", selectedTeamSlugs.join(","));
  }

  const teamFilterDataPromise = loadReportTeamFilterData(
    request,
    userToken,
    repositoryId,
    selectedTeamSlugs,
  );

  const statsPromise = (async () => {
    const response = await authenticatedFetch(url.toString(), userToken, {
      request,
      retryCount: 1,
    });
    if (!response.ok) {
      throw new Error("Failed to fetch reviewer stats");
    }
    const data: ReviewerStatsResponse = await response.json();
    return data;
  })();

  // Observe early failures while filter data loads; Await still receives the
  // original rejected promise and renders the report error state.
  void statsPromise.catch(() => {});

  const orgThresholdsPromise =
    reviewerFilters.length > 0 || selectedTeamSlugs.length > 0
      ? (async () => {
          try {
            const orgUrl = new URL(`${API_URL}/api/repository/${repositoryId}/reports/reviewers`);
            orgUrl.searchParams.set("startDate", formatDateForQuery(startDate));
            orgUrl.searchParams.set("endDate", formatDateForQuery(endDate));
            const response = await authenticatedFetch(orgUrl.toString(), userToken, {
              request,
              retryCount: 1,
            });
            if (!response.ok) return null;
            const data: ReviewerStatsResponse = await response.json();
            return data;
          } catch {
            return null;
          }
        })()
      : null;

  const usersPromise = (async () => {
    try {
      const response = await authenticatedFetch(
        `${API_URL}/api/repository/${repositoryId}/reports/users/activity`,
        userToken,
        { request },
      );
      if (!response.ok) {
        console.error("Failed to fetch user list");
        return [] as string[];
      }
      const data: UserActivityOverview[] = await response.json();
      const logins = data
        .map((entry) => entry.gh_login?.trim())
        .filter((login): login is string => Boolean(login));
      return Array.from(new Set(logins)).sort((a, b) => a.localeCompare(b));
    } catch (error) {
      console.error("Error fetching user list:", error);
      return [] as string[];
    }
  })();

  const [teamFilterData, users] = await Promise.all([teamFilterDataPromise, usersPromise]);

  return {
    stats: statsPromise,
    users,
    teams: teamFilterData.teams,
    selectedTeamMembers: teamFilterData.selectedTeamMembers,
    orgThresholds: orgThresholdsPromise,
    repositoryId,
  };
}

function LoadingState() {
  return (
    <div className="flex justify-center items-center h-32">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function TableErrorFallback({ tableColumns }: { tableColumns: ReturnType<typeof createColumns> }) {
  const error = useAsyncError();
  const revalidator = useRevalidator();
  const isTimeout = error instanceof Error && error.message.includes("Server Timeout");

  return (
    <div className="relative min-h-[400px]">
      <DataTable
        columns={tableColumns}
        data={[]}
        pinnedColumn="reviewer"
        maxHeight={REPORTS_TABLE_MAX_HEIGHT}
        showEmptyState={false}
        showCustomHorizontalScrollbar
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 rounded-lg border border-white/10 bg-slate-950/80">
        <p className="text-gray-300 text-center max-w-xl px-6">
          {isTimeout
            ? "Timeout fetching report. Please try again."
            : "Timeout fetching report. Please try again."}
        </p>
        <button
          type="button"
          onClick={() => {
            void revalidator.revalidate();
          }}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md transition-colors"
          disabled={revalidator.state === "loading"}
        >
          Retry
        </button>
      </div>
    </div>
  );
}

export function ReviewerReportsPage({
  loaderData,
  buildPath,
  repoRef,
}: {
  loaderData: ReviewerReportsLoaderData;
  buildPath: (search: string) => string;
  repoRef?: string;
}) {
  const { stats, users, teams, selectedTeamMembers, orgThresholds } = loaderData;
  const location = useLocation();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const tableColumns = useMemo(
    () => createColumns(loaderData.repositoryId),
    [loaderData.repositoryId],
  );
  const isRouteTransition =
    navigation.state === "loading" && navigation.location?.pathname !== location.pathname;
  const isRevalidating =
    navigation.state === "loading" && navigation.location?.pathname === location.pathname;
  const showInlineLoader = useSpinDelay(isRevalidating, {
    delay: 150,
    minDuration: 300,
  });
  const [searchParams] = useSearchParams();
  const usersParam = searchParams.get("users") ?? "";
  const selectedUsersFromUrl = useMemo(() => {
    return parseCommaSeparatedParam(usersParam);
  }, [usersParam]);
  const teamsParam = searchParams.get("teams") ?? "";
  const selectedTeamsFromUrl = useMemo(() => parseCommaSeparatedParam(teamsParam), [teamsParam]);
  const selectedUsersKey = selectedUsersFromUrl.join(",");
  const selectedTeamsKey = selectedTeamsFromUrl.join(",");
  const [pendingUsers, setPendingUsers] = useState<string[]>(selectedUsersFromUrl);
  useEffect(() => {
    setPendingUsers(selectedUsersFromUrl);
  }, [selectedUsersKey]);
  const [pendingTeams, setPendingTeams] = useState<string[]>(selectedTeamsFromUrl);
  useEffect(() => {
    setPendingTeams(selectedTeamsFromUrl);
  }, [selectedTeamsKey]);

  const [isTeamFilterOpen, setIsTeamFilterOpen] = useState(false);

  const [dateRange, setDateRange] = useState<DateRange>(() =>
    getDateRangeFromSearchParams(searchParams),
  );

  useEffect(() => {
    const nextRange = getDateRangeFromSearchParams(searchParams);
    setDateRange((current) => {
      return isSameDateRange(current, nextRange) ? current : nextRange;
    });
  }, [searchParams]);

  // Toggle for showing benchmark/ghost rows (defaults to OFF)
  const [showBenchmarks, setShowBenchmarks] = useState(false);

  const hasUserFilter = selectedUsersFromUrl.length > 0;
  const hasTeamFilter = selectedTeamsFromUrl.length > 0;
  const hasAnyFilter = hasUserFilter || hasTeamFilter;

  // Resolve org-wide data from background fetch (for benchmarks + category chips)
  // undefined = loading, null = not needed / failed, object = loaded
  const [resolvedOrgData, setResolvedOrgData] = useState<ReviewerStatsResponse | null | undefined>(
    hasAnyFilter ? undefined : null,
  );

  useEffect(() => {
    if (!orgThresholds) {
      setResolvedOrgData(null);
      return;
    }
    let cancelled = false;
    setResolvedOrgData(undefined);
    Promise.resolve(orgThresholds).then(
      (data) => {
        if (!cancelled) setResolvedOrgData(data);
      },
      () => {
        if (!cancelled) setResolvedOrgData(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [orgThresholds]);

  const benchmarksLoading = hasAnyFilter && resolvedOrgData === undefined;

  const updateUrl = useCallback(
    (range: DateRange, selectedUsers: string[], selectedTeams: string[]) => {
      if (!range.from || !range.to) return;
      const nextStart = formatDateForQuery(range.from);
      const nextEnd = formatDateForQuery(range.to);
      const nextUsers = selectedUsers.filter(Boolean).join(",");
      const nextTeams = selectedTeams.filter(Boolean).join(",");
      const currentStart = searchParams.get("startDate");
      const currentEnd = searchParams.get("endDate");
      const currentUsers = searchParams.get("users") ?? "";
      const currentTeams = searchParams.get("teams") ?? "";
      if (
        currentStart === nextStart &&
        currentEnd === nextEnd &&
        currentUsers === nextUsers &&
        currentTeams === nextTeams
      ) {
        return;
      }
      const params = new URLSearchParams(searchParams);
      params.set("startDate", nextStart);
      params.set("endDate", nextEnd);
      if (nextUsers) {
        params.set("users", nextUsers);
      } else {
        params.delete("users");
      }
      if (nextTeams) {
        params.set("teams", nextTeams);
      } else {
        params.delete("teams");
      }
      void navigate(buildPath(params.toString()));
    },
    [buildPath, navigate, searchParams],
  );

  const lastSyncedRangeRef = useRef<DateRange | null>(dateRange);

  const handleDateRangeChange = useCallback((range: DateRange) => {
    setDateRange(range);
  }, []);

  useEffect(() => {
    if (!dateRange.from || !dateRange.to) return;
    const previous = lastSyncedRangeRef.current;
    if (previous && isSameDateRange(previous, dateRange)) {
      return;
    }
    lastSyncedRangeRef.current = dateRange;
    updateUrl(dateRange, pendingUsers, pendingTeams);
  }, [dateRange, pendingTeams, pendingUsers, updateUrl]);

  useEffect(() => {
    if (!dateRange.from || !dateRange.to) return;
    const pendingUsersKey = pendingUsers.join(",");
    const pendingTeamsKey = pendingTeams.join(",");
    if (pendingUsersKey === selectedUsersKey && pendingTeamsKey === selectedTeamsKey) return;
    const timer = setTimeout(() => {
      updateUrl(dateRange, pendingUsers, pendingTeams);
    }, 800);
    return () => clearTimeout(timer);
  }, [pendingTeams, pendingUsers, selectedTeamsKey, selectedUsersKey, dateRange, updateUrl]);

  const teamSearchInputRef = useRef<HTMLInputElement | null>(null);
  const focusTeamSearchInput = () => {
    teamSearchInputRef.current?.focus();
  };

  const handleToggleUser = (username: string) => {
    setPendingTeams([]);
    setPendingUsers((current) => {
      if (current.includes(username)) {
        return current.filter((item) => item !== username);
      }
      return [...current, username];
    });
  };

  const handleRemoveUser = (username: string) => {
    setPendingUsers((current) => current.filter((item) => item !== username));
  };

  const handleToggleTeam = (teamSlug: string) => {
    setPendingUsers([]);
    setPendingTeams((current) => {
      if (current.includes(teamSlug)) {
        return current.filter((item) => item !== teamSlug);
      }
      return [...current, teamSlug];
    });
  };

  const handleRemoveTeam = (teamSlug: string) => {
    setPendingTeams((current) => current.filter((item) => item !== teamSlug));
  };

  const handleClearUsers = () => {
    setPendingUsers([]);
  };

  const handleClearTeams = () => {
    setPendingTeams([]);
  };

  const handleClearAllFilters = () => {
    setPendingUsers([]);
    setPendingTeams([]);
  };

  const visibleUsers = pendingUsers.slice(0, MAX_VISIBLE_CHIPS);
  const overflowCount = pendingUsers.length - visibleUsers.length;
  const selectedTeamMemberSet = useMemo(() => new Set(selectedTeamMembers), [selectedTeamMembers]);
  const selectedTeams = useMemo(
    () => teams.filter((team) => pendingTeams.includes(team.slug)),
    [pendingTeams, teams],
  );

  // When org data is available, use org rows for filtered users (has correct org-wide categories)
  const selectVisibleRows = useCallback(
    (resolved: ReviewerStatsResponse): ReviewerStats[] => {
      const filteredUserSet = new Set(selectedUsersFromUrl);
      return hasAnyFilter && resolvedOrgData
        ? resolvedOrgData.reviewers.filter((row) =>
            hasUserFilter
              ? filteredUserSet.has(row.reviewer)
              : selectedTeamMemberSet.has(row.reviewer),
          )
        : resolved.reviewers;
    },
    [hasAnyFilter, hasUserFilter, resolvedOrgData, selectedTeamMemberSet, selectedUsersFromUrl],
  );

  const handleExportCsv = useCallback(
    (rows: ReviewerStats[]) => {
      const from = dateRange.from
        ? formatDateForQuery(dateRange.from)
        : (searchParams.get("startDate") ?? "start");
      const to = dateRange.to
        ? formatDateForQuery(dateRange.to)
        : (searchParams.get("endDate") ?? "end");
      const filename = buildReportCsvFilename({ report: "reviewer_reports", repoRef, from, to });
      downloadCsv(filename, buildCsv(REVIEWER_CSV_COLUMNS, rows));
    },
    [dateRange.from, dateRange.to, repoRef, searchParams],
  );
  const visibleTeams = selectedTeams.slice(0, MAX_VISIBLE_CHIPS);
  const teamOverflowCount = selectedTeams.length - MAX_VISIBLE_CHIPS;

  const fallback = isRouteTransition ? null : <LoadingState />;

  return (
    <div className="font-sans text-white flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex-shrink-0 border-b border-white/10">
        <div className="flex flex-col gap-4 py-4 md:h-16 md:flex-row md:items-center md:justify-between md:gap-6 md:py-0">
          <h1 className="text-2xl font-semibold tracking-tight">Reviewer Reports</h1>

          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <ReportUserFilter
              label="reviewers"
              users={users}
              selectedUsers={pendingUsers}
              onToggle={handleToggleUser}
              onClear={handleClearUsers}
              disabled={pendingTeams.length > 0}
            />
            <Popover
              open={isTeamFilterOpen}
              onOpenChange={(open) => {
                setIsTeamFilterOpen(open);
                if (open) {
                  requestAnimationFrame(focusTeamSearchInput);
                }
              }}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex h-10 w-full md:w-[220px] items-center justify-between rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-400",
                    "border-white/20 bg-[#0f172a] text-white hover:border-blue-400 hover:bg-blue-500/10",
                    pendingUsers.length > 0 &&
                      "cursor-not-allowed opacity-50 hover:border-white/20 hover:bg-[#0f172a]",
                    pendingTeams.length > 0 && "border-blue-400",
                  )}
                  aria-label="Filter teams"
                  disabled={pendingUsers.length > 0}
                >
                  <span>Filter teams</span>
                  <ChevronDown className="h-4 w-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                sideOffset={8}
                className="z-[70] w-80 rounded-lg border border-white/10 bg-[#111827] p-0 text-white shadow-2xl"
                onOpenAutoFocus={(event) => {
                  event.preventDefault();
                  focusTeamSearchInput();
                }}
              >
                <Command
                  className="bg-transparent text-white"
                  filter={(value, search, keywords) => rankCommandMatch(value, search, keywords)}
                >
                  <div className="space-y-2 px-4 py-4">
                    <p className="text-xs uppercase tracking-wide text-gray-400">Search teams</p>
                    <div className="rounded-lg border border-white/15 bg-[#0f172a] px-3 py-1.5">
                      <CommandInput
                        ref={teamSearchInputRef}
                        placeholder="Search teams..."
                        className="h-8 w-full bg-transparent text-sm text-white placeholder:text-gray-500 focus-visible:border-0 focus-visible:ring-0"
                      />
                    </div>
                  </div>
                  <CommandList className="max-h-64">
                    <CommandEmpty className="py-4 text-center text-sm text-gray-400">
                      No teams found
                    </CommandEmpty>
                    <CommandGroup className="p-0">
                      {teams.map((team) => {
                        const isSelected = pendingTeams.includes(team.slug);
                        return (
                          <CommandItem
                            key={team.teamId}
                            value={team.name}
                            keywords={[team.slug]}
                            onSelect={() => {
                              if (pendingUsers.length > 0) return;
                              handleToggleTeam(team.slug);
                              requestAnimationFrame(focusTeamSearchInput);
                            }}
                            className={cn(
                              "flex cursor-pointer select-none items-center justify-between px-4 py-2 text-sm text-white",
                              "data-[selected=true]:bg-blue-500/20 data-[selected=true]:text-white",
                            )}
                          >
                            <div className="min-w-0">
                              <div className="truncate">{team.name}</div>
                              <div className="text-xs text-gray-400">
                                {team.memberCount} members
                              </div>
                            </div>
                            {isSelected && <Check className="h-4 w-4 shrink-0 text-blue-300" />}
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
                <div className="flex items-center justify-between border-t border-white/10 px-4 py-3">
                  <span className="text-sm text-gray-400">{pendingTeams.length} selected</span>
                  <button
                    type="button"
                    className="text-sm font-semibold text-blue-300 hover:text-blue-200"
                    onClick={() => {
                      handleClearTeams();
                      requestAnimationFrame(focusTeamSearchInput);
                    }}
                  >
                    Clear all
                  </button>
                </div>
              </PopoverContent>
            </Popover>
            <EnhancedDateRangePicker
              className="w-full md:w-[240px]"
              onChange={handleDateRangeChange}
              value={dateRange}
            />
          </div>
        </div>
      </div>
      {/* Consolidated action bar: filter tags (left) + toggle (right) */}
      <div className="flex items-center justify-between gap-4 border-b border-white/10 py-2">
        {/* Left side: filter tags */}
        <div className="flex flex-1 min-w-0 items-center gap-2">
          {(selectedTeams.length > 0 || pendingUsers.length > 0) && (
            <>
              <div className="flex items-center gap-2 overflow-hidden">
                {visibleTeams.map((team) => (
                  <Badge
                    key={team.teamId}
                    variant="secondary"
                    className="flex-shrink-0 flex items-center gap-1"
                  >
                    {team.name}
                    <button
                      type="button"
                      onClick={() => handleRemoveTeam(team.slug)}
                      aria-label={`Remove ${team.name}`}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {visibleUsers.map((username) => (
                  <Badge
                    key={username}
                    variant="secondary"
                    className="flex-shrink-0 flex items-center gap-1"
                  >
                    {username}
                    <button
                      type="button"
                      onClick={() => handleRemoveUser(username)}
                      aria-label={`Remove ${username}`}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              {teamOverflowCount > 0 && (
                <span className="flex-shrink-0 rounded-full border border-white/20 px-2 py-1 text-xs text-gray-300">
                  +{teamOverflowCount} teams
                </span>
              )}
              {overflowCount > 0 && (
                <span className="flex-shrink-0 rounded-full border border-white/20 px-2 py-1 text-xs text-gray-300">
                  +{overflowCount} more
                </span>
              )}
            </>
          )}
        </div>

        {/* Right side: Clear all (if filters) + Toggle */}
        <div className="flex items-center gap-4">
          <Suspense fallback={<ExportCsvButton disabled onExport={() => {}} />}>
            <Await resolve={stats} errorElement={<ExportCsvButton disabled onExport={() => {}} />}>
              {(resolved: ReviewerStatsResponse) => {
                const rows = selectVisibleRows(resolved);
                return (
                  <ExportCsvButton
                    disabled={rows.length === 0}
                    onExport={() => handleExportCsv(rows)}
                  />
                );
              }}
            </Await>
          </Suspense>
          {(pendingUsers.length > 0 || pendingTeams.length > 0) && (
            <button
              type="button"
              onClick={handleClearAllFilters}
              className="text-sm font-medium text-blue-300 hover:text-blue-200"
            >
              Clear all
            </button>
          )}
          <ReportTiersToggle
            checked={showBenchmarks}
            onChange={setShowBenchmarks}
            loading={benchmarksLoading}
            description="Compare reviewers to org-wide percentile tiers for the selected period."
          />
        </div>
      </div>

      <div className="relative flex flex-1 min-h-0 min-w-0 flex-col pt-2">
        {showInlineLoader && (
          <div
            className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/70"
            aria-live="polite"
            aria-busy="true"
          >
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="sr-only">Refreshing reviewer stats…</span>
          </div>
        )}
        <Suspense fallback={fallback}>
          <Await resolve={stats} errorElement={<TableErrorFallback tableColumns={tableColumns} />}>
            {(resolved: ReviewerStatsResponse) => {
              const thresholds = hasAnyFilter
                ? (resolvedOrgData?.thresholds ?? [])
                : resolved.thresholds;

              const data = selectVisibleRows(resolved);

              return data?.length ? (
                <DataTable
                  columns={tableColumns}
                  data={data}
                  pinnedRows={showBenchmarks ? thresholds : []}
                  pinnedColumn="reviewer"
                  maxHeight={REPORTS_TABLE_MAX_HEIGHT}
                  showCustomHorizontalScrollbar
                />
              ) : (
                <EmptyState message="No reviewer data available for the selected period." />
              );
            }}
          </Await>
        </Suspense>
      </div>
    </div>
  );
}
