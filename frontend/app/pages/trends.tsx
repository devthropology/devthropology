import {
  type MetaFunction,
  useLoaderData,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { API_URL, authenticatedFetch } from "~/config";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/EmptyState";
import { CellTooltip } from "~/components/ui/cell-tooltip";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { cn } from "~/lib/utils";
import { Check, ChevronDown } from "lucide-react";
import { rankCommandMatch } from "~/utils/commandRanking";
import { PrSizeMixComparisonChart } from "~/components/trends/PrSizeMixComparisonChart";
import {
  type PrSizeMixComparisonMode,
  PrSizeMixPivotControlGroup,
  PrSizeMixPivotTable,
  type PrSizeMixValueMode,
} from "~/components/trends/PrSizeMixPivotTable";
import { PrSizeMixPivotDataTable } from "~/components/trends/PrSizeMixPivotDataTable";
import {
  PR_SIZE_PERCENTILE_METRICS,
  type PrSizePercentileMetricKey,
  PrSizePercentileTrendChart,
} from "~/components/trends/PrSizePercentileTrendChart";
import {
  REVIEW_ROUNDS_METRICS,
  REVIEW_ROUNDS_SCOPES,
  type ReviewRoundsMetricKey,
  type ReviewRoundsScopeKey,
  ReviewRoundsSeasonalityChart,
} from "~/components/trends/ReviewRoundsSeasonalityChart";
import {
  PrReviewTimingSeasonalityChart,
  REVIEW_TIMING_FAMILIES,
  REVIEW_TIMING_METRICS,
  type ReviewTimingFamilyKey,
  type ReviewTimingMetricKey,
} from "~/components/trends/PrReviewTimingSeasonalityChart";
import { PrReviewTimingBySizeChart } from "~/components/trends/PrReviewTimingBySizeChart";
import {
  SIZE_REVIEW_MODES,
  SIZE_REVIEW_ROUNDS_SCOPES,
  type SizeReviewMode,
  type SizeReviewRoundsScopeKey,
} from "~/components/trends/PrReviewTimingBySizeChart";
import {
  AUTHOR_OUTPUT_FAMILIES,
  AUTHOR_OUTPUT_PERCENTILE_METRICS,
  type AuthorOutputFamilyKey,
  type AuthorOutputPercentileMetricKey,
  AuthorOutputPercentileTrendChart,
} from "~/components/trends/AuthorOutputPercentileTrendChart";
import {
  PrReviewTimingBySizeTable,
  type ReviewTimingComparisonMode,
} from "~/components/trends/PrReviewTimingBySizeTable";
import {
  AI_ASSISTED_METRICS,
  type AiAssistedMetricKey,
  AiAssistedTrendChart,
} from "~/components/trends/AiAssistedTrendChart";
import { PR_SIZE_BUCKET_SHORT_LABELS, SIZE_BUCKET_COLORS } from "~/components/trends/prSizeBuckets";
import { getYearPillStyle } from "~/components/trends/yearColors";
import { AI_PR_SIZE_BUCKETS } from "../../../shared/models/trendsInsights";
import type {
  TrendsAiAssistedInsightsResponse,
  TrendsAiAssistedModelMonthlyPoint,
  TrendsAiAssistedMonthlyPoint,
  TrendsAuthorOutputMonthlyPoint,
  TrendsInsightsResponse,
  TrendsPrSizeBucket,
  TrendsPrSizeInsightsResponse,
  TrendsPrSizeMonthlyPoint,
  TrendsPrSizePercentileMonthlyPoint,
  TrendsPrSizePercentilesResponse,
  TrendsReviewRoundsInsightsResponse,
  TrendsReviewRoundsMonthlyPoint,
} from "../../../shared/models/trendsInsights";
import type { Team } from "../../../shared/models/team";

export const meta: MetaFunction = () => [
  { title: "Trends" },
  {
    name: "description",
    content:
      "Review friction, latency, PR size, and author output trends across your pull request process.",
  },
];

type TrendsPageLoaderData = {
  trends: TrendsInsightsResponse;
  teams: Team[];
  selectedTeamSlug: string | null;
};

const EMPTY_TEAMS: Team[] = [];
const EMPTY_TRENDS: TrendsInsightsResponse = { monthly: [] };
const USE_EXPERIMENTAL_PR_SIZE_MIX_TABLE = true;

function buildTrendsApiUrl(path: string, repositoryId: string, teamSlug?: string | null) {
  const url = new URL(`${API_URL}/api/repository/${repositoryId}${path}`);
  if (teamSlug) {
    url.searchParams.set("team", teamSlug);
  }
  return url.toString();
}

async function fetchTrendsData<T>(
  url: string,
  userToken: string,
  request: Request,
  fallback: T,
): Promise<T> {
  try {
    const response = await authenticatedFetch(url, userToken, {
      request,
      retryCount: 1,
    });

    if (!response.ok) {
      console.error(`Failed to fetch trends data from ${url}:`, response.status);
      return fallback;
    }

    return (await response.json()) as T;
  } catch (error) {
    console.error(`Error fetching trends data from ${url}:`, error);
    return fallback;
  }
}

export async function loadTrendsData(
  request: Request,
  userToken: string,
  repositoryId: string,
): Promise<TrendsPageLoaderData> {
  const requestUrl = new URL(request.url);
  const selectedTeamSlug = requestUrl.searchParams.get("team")?.trim() || null;

  if (!repositoryId) {
    return {
      trends: EMPTY_TRENDS,
      teams: EMPTY_TEAMS,
      selectedTeamSlug: null,
    };
  }

  const [trends, teams] = await Promise.all([
    fetchTrendsData(
      buildTrendsApiUrl("/explore/trends", repositoryId, selectedTeamSlug),
      userToken,
      request,
      EMPTY_TRENDS,
    ),
    fetchTrendsData(
      `${API_URL}/api/repository/${repositoryId}/teams`,
      userToken,
      request,
      EMPTY_TEAMS,
    ),
  ]);

  return {
    trends,
    teams,
    selectedTeamSlug,
  };
}

function MetricPill({
  children,
  isSelected,
  onClick,
}: {
  children: ReactNode;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn(
        "border-transparent bg-transparent text-gray-400 shadow-none hover:bg-white/5 hover:text-white",
        isSelected && "bg-white/10 text-white",
      )}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function YearPill({
  year,
  isSelected,
  onClick,
}: {
  year: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn(
        "h-auto min-w-[58px] max-w-full whitespace-normal border-white/10 px-3 py-1.5 text-center leading-tight shadow-none",
        isSelected
          ? "text-white"
          : "bg-transparent text-gray-500 hover:bg-white/5 hover:text-gray-300",
      )}
      style={getYearPillStyle(year, isSelected)}
      onClick={onClick}
    >
      {year}
    </Button>
  );
}

function YearRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-start gap-1.5", className)}>{children}</div>;
}

function getSizeBucketPillStyle(bucket: TrendsPrSizeBucket, isSelected: boolean) {
  const color = SIZE_BUCKET_COLORS[bucket];
  return {
    borderColor: isSelected ? `${color}99` : "rgba(255, 255, 255, 0.1)",
    backgroundColor: isSelected ? `${color}22` : "rgba(255, 255, 255, 0.03)",
    color: isSelected ? color : "rgba(255, 255, 255, 0.72)",
  };
}

function sortSizeBuckets(buckets: TrendsPrSizeBucket[]) {
  return [...buckets].sort(
    (left, right) => AI_PR_SIZE_BUCKETS.indexOf(left) - AI_PR_SIZE_BUCKETS.indexOf(right),
  );
}

function getPrSizeBucketRangeLabel(bucket: TrendsPrSizeBucket) {
  if (bucket === "Micro (0-10)") return "0 - 10";
  if (bucket === "Small (11-75)") return "11 - 75";
  if (bucket === "Medium (76-250)") return "76 - 250";
  if (bucket === "Large (251-500)") return "251 - 500";
  if (bucket === "XL (501-1000)") return "501 - 1000";
  return "1000+";
}

export default function TrendsPage() {
  const { trends, teams, selectedTeamSlug } = useLoaderData<TrendsPageLoaderData>();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isTeamFilterOpen, setIsTeamFilterOpen] = useState(false);
  const teamSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [reviewMetric, setReviewMetric] = useState<ReviewRoundsMetricKey>("avgRounds");
  const [reviewRoundsScope, setReviewRoundsScope] = useState<ReviewRoundsScopeKey>("human");
  const [reviewTimingMetric, setReviewTimingMetric] = useState<ReviewTimingMetricKey>("p50");
  const [selectedReviewTimingFamilies, setSelectedReviewTimingFamilies] = useState<
    ReviewTimingFamilyKey[]
  >(["review"]);
  const [reviewBySizeMode, setReviewBySizeMode] = useState<SizeReviewMode>("timing");
  const [reviewRoundsBySizeScope, setReviewRoundsBySizeScope] =
    useState<SizeReviewRoundsScopeKey>("human");
  const [reviewTimingBySizeFamily, setReviewTimingBySizeFamily] =
    useState<ReviewTimingFamilyKey>("review");
  const [reviewTimingBySizeMetric, setReviewTimingBySizeMetric] =
    useState<ReviewTimingMetricKey>("p50");
  const [reviewTimingBySizeBuckets, setReviewTimingBySizeBuckets] = useState<TrendsPrSizeBucket[]>([
    AI_PR_SIZE_BUCKETS[0],
  ]);
  const [reviewTimingBySizeComparisonMode, setReviewTimingBySizeComparisonMode] =
    useState<ReviewTimingComparisonMode>("priorMonth");
  const [prSizePercentileMetric, setPrSizePercentileMetric] =
    useState<PrSizePercentileMetricKey>("p50PrSize");
  const [authorOutputFamily, setAuthorOutputFamily] = useState<AuthorOutputFamilyKey>("mergedPrs");
  const [authorOutputPercentileMetric, setAuthorOutputPercentileMetric] =
    useState<AuthorOutputPercentileMetricKey>("avg");
  const [aiAssistedMetric, setAiAssistedMetric] = useState<AiAssistedMetricKey>("pctAiAssistedPrs");

  const reviewRounds = useMemo<TrendsReviewRoundsInsightsResponse>(
    () => ({
      points: trends.monthly.flatMap((month): TrendsReviewRoundsMonthlyPoint[] =>
        month.reviewRounds ? [{ year: month.year, month: month.month, ...month.reviewRounds }] : [],
      ),
    }),
    [trends.monthly],
  );
  const prSizes = useMemo<TrendsPrSizeInsightsResponse>(
    () => ({
      points: trends.monthly.flatMap((month): TrendsPrSizeMonthlyPoint[] =>
        month.prSizeDistribution.buckets.map((bucket) => ({
          year: month.year,
          month: month.month,
          ...bucket,
        })),
      ),
    }),
    [trends.monthly],
  );
  const prSizePercentiles = useMemo<TrendsPrSizePercentilesResponse>(
    () => ({
      points: trends.monthly.flatMap((month): TrendsPrSizePercentileMonthlyPoint[] =>
        month.prSize
          ? [
              {
                year: month.year,
                month: month.month,
                mergedPrs: month.mergedPrs ?? 0,
                ...month.prSize,
              },
            ]
          : [],
      ),
      authorOutput: {
        points: trends.monthly.flatMap((month): TrendsAuthorOutputMonthlyPoint[] =>
          month.authorOutput
            ? [{ year: month.year, month: month.month, ...month.authorOutput }]
            : [],
        ),
      },
    }),
    [trends.monthly],
  );
  const aiAssisted = useMemo<TrendsAiAssistedInsightsResponse>(
    () => ({
      points: trends.monthly.flatMap((month): TrendsAiAssistedMonthlyPoint[] =>
        month.aiAssisted
          ? [
              {
                year: month.year,
                month: month.month,
                mergedPrs: month.mergedPrs ?? 0,
                aiAssistedPrs: month.aiAssisted.aiAssistedPrs,
                pctAiAssistedPrs: month.aiAssisted.pctAiAssistedPrs,
              },
            ]
          : [],
      ),
      modelPoints: trends.monthly.flatMap((month): TrendsAiAssistedModelMonthlyPoint[] =>
        month.aiAssisted
          ? month.aiAssisted.models.map((model) => ({
              year: month.year,
              month: month.month,
              mergedPrs: month.mergedPrs ?? 0,
              ...model,
            }))
          : [],
      ),
    }),
    [trends.monthly],
  );

  const availableYears = useMemo(
    () =>
      Array.from(
        new Set([
          ...aiAssisted.points.map((point) => point.year),
          ...prSizes.points.map((point) => point.year),
          ...reviewRounds.points.map((point) => point.year),
          ...prSizePercentiles.points.map((point) => point.year),
        ]),
      ).sort((a, b) => a - b),
    [aiAssisted.points, prSizePercentiles.points, prSizes.points, reviewRounds.points],
  );
  const aiAssistedAvailableYears = useMemo(
    () => availableYears.filter((year) => year >= 2025),
    [availableYears],
  );
  const [selectedReviewYears, setSelectedReviewYears] = useState<number[]>(
    availableYears.slice(-Math.min(3, availableYears.length)),
  );
  const [selectedReviewTimingYears, setSelectedReviewTimingYears] = useState<number[]>(
    availableYears.slice(-Math.min(3, availableYears.length)),
  );
  const [selectedPrSizePercentileYears, setSelectedPrSizePercentileYears] = useState<number[]>(
    availableYears.slice(-Math.min(3, availableYears.length)),
  );
  const [selectedAuthorOutputYears, setSelectedAuthorOutputYears] = useState<number[]>(
    availableYears.slice(-Math.min(3, availableYears.length)),
  );
  const [selectedComparisonYears, setSelectedComparisonYears] = useState<number[]>(
    availableYears.slice(-Math.min(3, availableYears.length)),
  );
  const [selectedReviewTimingBySizeYears, setSelectedReviewTimingBySizeYears] = useState<number[]>(
    availableYears.slice(-Math.min(3, availableYears.length)),
  );
  const [selectedAiAssistedYears, setSelectedAiAssistedYears] =
    useState<number[]>(aiAssistedAvailableYears);
  const [prSizeMixValueMode, setPrSizeMixValueMode] = useState<PrSizeMixValueMode>("mix");
  const [prSizeMixComparisonMode, setPrSizeMixComparisonMode] =
    useState<PrSizeMixComparisonMode>("priorMonth");
  const selectedTeam = useMemo(
    () => teams.find((team) => team.slug === selectedTeamSlug) ?? null,
    [teams, selectedTeamSlug],
  );
  const teamFilterLabel =
    selectedTeam?.name ??
    (selectedTeamSlug ? `Unknown team: ${selectedTeamSlug}` : "All contributors");
  const prSizeLegendTooltip = (
    <div className="flex min-w-[180px] flex-col gap-1.5">
      {AI_PR_SIZE_BUCKETS.map((bucket) => (
        <div key={bucket} className="flex items-center gap-2 text-xs text-gray-200">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: SIZE_BUCKET_COLORS[bucket] }}
            aria-hidden="true"
          />
          <span className="font-medium text-white">{PR_SIZE_BUCKET_SHORT_LABELS[bucket]}:</span>
          <span>{getPrSizeBucketRangeLabel(bucket)}</span>
        </div>
      ))}
    </div>
  );

  const focusTeamSearchInput = () => {
    teamSearchInputRef.current?.focus();
  };

  const updateTeamFilter = (teamSlug: string | null) => {
    const nextSearchParams = new URLSearchParams(searchParams);
    if (teamSlug) {
      nextSearchParams.set("team", teamSlug);
    } else {
      nextSearchParams.delete("team");
    }

    const nextSearch = nextSearchParams.toString();
    const currentSearch = searchParams.toString();
    if (nextSearch === currentSearch) {
      setIsTeamFilterOpen(false);
      return;
    }

    void navigate({
      pathname: location.pathname,
      search: nextSearch ? `?${nextSearch}` : "",
    });
    setIsTeamFilterOpen(false);
  };

  useEffect(() => {
    const validYears = selectedReviewYears.filter((year) => availableYears.includes(year));
    const nextYears =
      validYears.length > 0
        ? validYears
        : availableYears.slice(-Math.min(3, availableYears.length));

    if (selectedReviewYears.join(",") !== nextYears.join(",")) {
      setSelectedReviewYears(nextYears);
    }
  }, [availableYears, selectedReviewYears]);

  useEffect(() => {
    const validYears = selectedPrSizePercentileYears.filter((year) =>
      availableYears.includes(year),
    );
    const nextYears =
      validYears.length > 0
        ? validYears
        : availableYears.slice(-Math.min(3, availableYears.length));

    if (selectedPrSizePercentileYears.join(",") !== nextYears.join(",")) {
      setSelectedPrSizePercentileYears(nextYears);
    }
  }, [availableYears, selectedPrSizePercentileYears]);

  useEffect(() => {
    const validYears = selectedAuthorOutputYears.filter((year) => availableYears.includes(year));
    const nextYears =
      validYears.length > 0
        ? validYears
        : availableYears.slice(-Math.min(3, availableYears.length));

    if (selectedAuthorOutputYears.join(",") !== nextYears.join(",")) {
      setSelectedAuthorOutputYears(nextYears);
    }
  }, [availableYears, selectedAuthorOutputYears]);

  useEffect(() => {
    const validYears = selectedReviewTimingYears.filter((year) => availableYears.includes(year));
    const nextYears =
      validYears.length > 0
        ? validYears
        : availableYears.slice(-Math.min(3, availableYears.length));

    if (selectedReviewTimingYears.join(",") !== nextYears.join(",")) {
      setSelectedReviewTimingYears(nextYears);
    }
  }, [availableYears, selectedReviewTimingYears]);

  useEffect(() => {
    const validYears = selectedComparisonYears.filter((year) => availableYears.includes(year));
    const nextYears =
      validYears.length > 0
        ? validYears
        : availableYears.slice(-Math.min(3, availableYears.length));

    if (selectedComparisonYears.join(",") !== nextYears.join(",")) {
      setSelectedComparisonYears(nextYears);
    }
  }, [availableYears, selectedComparisonYears]);

  useEffect(() => {
    const validYears = selectedReviewTimingBySizeYears.filter((year) =>
      availableYears.includes(year),
    );
    const nextYears =
      validYears.length > 0
        ? validYears
        : availableYears.slice(-Math.min(3, availableYears.length));

    if (selectedReviewTimingBySizeYears.join(",") !== nextYears.join(",")) {
      setSelectedReviewTimingBySizeYears(nextYears);
    }
  }, [availableYears, selectedReviewTimingBySizeYears]);

  useEffect(() => {
    const validYears = selectedAiAssistedYears.filter((year) =>
      aiAssistedAvailableYears.includes(year),
    );
    const nextYears = validYears.length > 0 ? validYears : aiAssistedAvailableYears;

    if (selectedAiAssistedYears.join(",") !== nextYears.join(",")) {
      setSelectedAiAssistedYears(nextYears);
    }
  }, [aiAssistedAvailableYears, selectedAiAssistedYears]);

  function toggleReviewTimingFamily(family: ReviewTimingFamilyKey) {
    setSelectedReviewTimingFamilies((current) => {
      if (current.includes(family)) {
        return current.filter((value) => value !== family);
      }
      return [...current, family];
    });
  }

  const toggleComparisonYear = (year: number) => {
    setSelectedComparisonYears((currentYears) => {
      if (currentYears.includes(year)) {
        return currentYears.filter((entry) => entry !== year);
      }

      return [...currentYears, year].sort((a, b) => a - b);
    });
  };

  const togglePrSizePercentileYear = (year: number) => {
    setSelectedPrSizePercentileYears((currentYears) => {
      if (currentYears.includes(year)) {
        return currentYears.filter((entry) => entry !== year);
      }

      return [...currentYears, year].sort((a, b) => a - b);
    });
  };

  const toggleAuthorOutputYear = (year: number) => {
    setSelectedAuthorOutputYears((currentYears) => {
      if (currentYears.includes(year)) {
        return currentYears.filter((entry) => entry !== year);
      }

      return [...currentYears, year].sort((a, b) => a - b);
    });
  };

  const toggleReviewYear = (year: number) => {
    setSelectedReviewYears((currentYears) => {
      if (currentYears.includes(year)) {
        return currentYears.filter((entry) => entry !== year);
      }

      return [...currentYears, year].sort((a, b) => a - b);
    });
  };

  const toggleReviewTimingYear = (year: number) => {
    setSelectedReviewTimingYears((currentYears) => {
      if (currentYears.includes(year)) {
        return currentYears.filter((entry) => entry !== year);
      }

      return [...currentYears, year].sort((a, b) => a - b);
    });
  };

  const toggleReviewTimingBySizeYear = (year: number) => {
    setSelectedReviewTimingBySizeYears((currentYears) => {
      if (currentYears.includes(year)) {
        return currentYears.filter((entry) => entry !== year);
      }

      return [...currentYears, year].sort((a, b) => a - b);
    });
  };

  const toggleAiAssistedYear = (year: number) => {
    setSelectedAiAssistedYears((currentYears) => {
      if (currentYears.includes(year)) {
        return currentYears.filter((entry) => entry !== year);
      }

      return [...currentYears, year].sort((a, b) => a - b);
    });
  };

  const toggleReviewTimingBySizeBucket = (bucket: TrendsPrSizeBucket) => {
    setReviewTimingBySizeBuckets((currentBuckets) => {
      if (currentBuckets.includes(bucket)) {
        return currentBuckets.filter((entry) => entry !== bucket);
      }

      if (currentBuckets.length >= 3) {
        return currentBuckets;
      }

      return sortSizeBuckets([...currentBuckets, bucket]);
    });
  };

  if (
    reviewRounds.points.length === 0 &&
    prSizes.points.length === 0 &&
    aiAssisted.points.length === 0
  ) {
    return (
      <div className="font-sans text-white flex h-full min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex-shrink-0 border-b border-white/10">
          <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between md:h-16 md:gap-6 md:py-0">
            <h1 className="text-2xl font-semibold tracking-tight">Trends</h1>
            <div className="text-sm text-gray-400">
              {selectedTeam ? `Filtered to ${selectedTeam.name}` : "Showing all contributors"}
            </div>
          </div>
        </div>
        <div className="flex-1 min-h-0 min-w-0 pt-2">
          <EmptyState message="No trends data is available for this repository yet." />
        </div>
      </div>
    );
  }

  return (
    <div className="font-sans text-white flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex-shrink-0 border-b border-white/10">
        <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between md:h-16 md:gap-6 md:py-0">
          <h1 className="text-2xl font-semibold tracking-tight">Trends</h1>

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
                  "inline-flex h-10 w-full sm:w-[260px] items-center justify-between rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-400",
                  "border-white/20 bg-[#0f172a] text-white hover:border-blue-400 hover:bg-blue-500/10",
                  selectedTeam && "border-blue-400",
                )}
                aria-label="Filter trends by team"
              >
                <span className="truncate">{teamFilterLabel}</span>
                <ChevronDown className="ml-2 h-4 w-4 shrink-0" />
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
                  <p className="text-xs uppercase tracking-wide text-gray-400">Filter by team</p>
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
                    <CommandItem
                      value="all contributors"
                      keywords={["all", "contributors"]}
                      onSelect={() => updateTeamFilter(null)}
                      className="flex cursor-pointer select-none items-center justify-between px-4 py-2 text-sm text-white data-[selected=true]:bg-blue-500/20 data-[selected=true]:text-white"
                    >
                      <span>All contributors</span>
                      {!selectedTeam && <Check className="h-4 w-4 text-blue-300" />}
                    </CommandItem>
                    {teams.map((team) => {
                      const isSelected = team.slug === selectedTeamSlug;
                      return (
                        <CommandItem
                          key={team.teamId}
                          value={team.name}
                          keywords={[team.slug]}
                          onSelect={() => updateTeamFilter(team.slug)}
                          className="flex cursor-pointer select-none items-center justify-between px-4 py-2 text-sm text-white data-[selected=true]:bg-blue-500/20 data-[selected=true]:text-white"
                        >
                          <div className="min-w-0">
                            <div className="truncate">{team.name}</div>
                            <div className="text-xs text-gray-400">{team.memberCount} members</div>
                          </div>
                          {isSelected && <Check className="ml-3 h-4 w-4 shrink-0 text-blue-300" />}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="flex-1 min-h-0 min-w-0 pt-2">
        <div className="space-y-6 pb-6">
          <div className="grid min-w-0 gap-6 xl:grid-cols-2 xl:items-start">
            <section className="min-w-0 rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="flex flex-col gap-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="max-w-xl flex-1">
                    <h2 className="text-lg font-semibold text-white">PR Size</h2>
                  </div>

                  <div className="invisible ml-auto hidden w-fit flex-wrap gap-1 rounded-lg bg-white/5 p-1 xl:flex">
                    {REVIEW_ROUNDS_SCOPES.map((option) => (
                      <MetricPill key={option.key} isSelected={false} onClick={() => undefined}>
                        {option.label}
                      </MetricPill>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <YearRow className="min-w-0 flex-1">
                    {availableYears.map((year) => (
                      <YearPill
                        key={year}
                        year={year}
                        isSelected={selectedPrSizePercentileYears.includes(year)}
                        onClick={() => togglePrSizePercentileYear(year)}
                      />
                    ))}
                  </YearRow>

                  <div className="self-start sm:w-[226px] sm:shrink-0">
                    <div className="ml-auto flex w-fit flex-nowrap gap-1 rounded-lg bg-white/5 p-1">
                      {PR_SIZE_PERCENTILE_METRICS.map((option) => (
                        <MetricPill
                          key={option.key}
                          isSelected={prSizePercentileMetric === option.key}
                          onClick={() => setPrSizePercentileMetric(option.key)}
                        >
                          {option.label}
                        </MetricPill>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg bg-white/5 p-4">
                  <div className="h-[320px]">
                    <PrSizePercentileTrendChart
                      points={prSizePercentiles.points}
                      metric={prSizePercentileMetric}
                      selectedYears={selectedPrSizePercentileYears}
                    />
                  </div>
                </div>
              </div>
            </section>

            <section className="min-w-0 rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="flex flex-col gap-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="max-w-xl flex-1">
                    <h2 className="text-lg font-semibold text-white">Author Output</h2>
                  </div>

                  <div className="ml-auto flex w-fit flex-wrap gap-1 rounded-lg bg-white/5 p-1">
                    {AUTHOR_OUTPUT_FAMILIES.map((option) => (
                      <MetricPill
                        key={option.key}
                        isSelected={authorOutputFamily === option.key}
                        onClick={() => setAuthorOutputFamily(option.key)}
                      >
                        {option.label}
                      </MetricPill>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <YearRow className="min-w-0 flex-1">
                    {availableYears.map((year) => (
                      <YearPill
                        key={year}
                        year={year}
                        isSelected={selectedAuthorOutputYears.includes(year)}
                        onClick={() => toggleAuthorOutputYear(year)}
                      />
                    ))}
                  </YearRow>

                  <div className="self-start sm:w-[226px] sm:shrink-0">
                    <div className="ml-auto flex w-fit flex-nowrap gap-1 rounded-lg bg-white/5 p-1">
                      {AUTHOR_OUTPUT_PERCENTILE_METRICS.map((option) => (
                        <MetricPill
                          key={option.key}
                          isSelected={authorOutputPercentileMetric === option.key}
                          onClick={() => setAuthorOutputPercentileMetric(option.key)}
                        >
                          {option.label}
                        </MetricPill>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg bg-white/5 p-4">
                  <div className="h-[320px]">
                    <AuthorOutputPercentileTrendChart
                      points={prSizePercentiles.authorOutput.points}
                      family={authorOutputFamily}
                      metric={authorOutputPercentileMetric}
                      selectedYears={selectedAuthorOutputYears}
                    />
                  </div>
                </div>
              </div>
            </section>

            <section className="min-w-0 rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="flex flex-col gap-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="max-w-xl flex-1">
                    <h2 className="text-lg font-semibold text-white">Rounds of Review</h2>
                  </div>

                  <div className="ml-auto flex w-fit flex-wrap gap-1 rounded-lg bg-white/5 p-1">
                    {REVIEW_ROUNDS_SCOPES.map((option) => (
                      <MetricPill
                        key={option.key}
                        isSelected={reviewRoundsScope === option.key}
                        onClick={() => setReviewRoundsScope(option.key)}
                      >
                        {option.label}
                      </MetricPill>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <YearRow className="min-w-0 flex-1">
                    {availableYears.map((year) => (
                      <YearPill
                        key={year}
                        year={year}
                        isSelected={selectedReviewYears.includes(year)}
                        onClick={() => toggleReviewYear(year)}
                      />
                    ))}
                  </YearRow>

                  <div className="self-start sm:shrink-0">
                    <div className="flex w-fit flex-nowrap gap-1 rounded-lg bg-white/5 p-1">
                      {REVIEW_ROUNDS_METRICS.map((option) => (
                        <MetricPill
                          key={option.key}
                          isSelected={reviewMetric === option.key}
                          onClick={() => setReviewMetric(option.key)}
                        >
                          {option.label}
                        </MetricPill>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg bg-white/5 p-4">
                  <div className="h-[320px]">
                    <ReviewRoundsSeasonalityChart
                      points={reviewRounds.points}
                      metric={reviewMetric}
                      scope={reviewRoundsScope}
                      selectedYears={selectedReviewYears}
                    />
                  </div>
                </div>
              </div>
            </section>

            <section className="min-w-0 rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="flex flex-col gap-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="max-w-xl flex-1">
                    <h2 className="text-lg font-semibold text-white">Review Latency</h2>
                  </div>

                  <div className="ml-auto flex w-fit flex-wrap gap-1 rounded-lg bg-white/5 p-1">
                    {REVIEW_TIMING_FAMILIES.map((option) => (
                      <MetricPill
                        key={option.key}
                        isSelected={selectedReviewTimingFamilies.includes(option.key)}
                        onClick={() => toggleReviewTimingFamily(option.key)}
                      >
                        {option.label}
                      </MetricPill>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <YearRow className="min-w-0 flex-1">
                    {availableYears.map((year) => (
                      <YearPill
                        key={year}
                        year={year}
                        isSelected={selectedReviewTimingYears.includes(year)}
                        onClick={() => toggleReviewTimingYear(year)}
                      />
                    ))}
                  </YearRow>

                  <div className="self-start sm:shrink-0">
                    <div className="flex w-fit flex-nowrap gap-1 rounded-lg bg-white/5 p-1">
                      {REVIEW_TIMING_METRICS.map((option) => (
                        <MetricPill
                          key={option.key}
                          isSelected={reviewTimingMetric === option.key}
                          onClick={() => setReviewTimingMetric(option.key)}
                        >
                          {option.label}
                        </MetricPill>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg bg-white/5 p-4">
                  <div className="h-[320px]">
                    <PrReviewTimingSeasonalityChart
                      points={reviewRounds.points}
                      metric={reviewTimingMetric}
                      selectedFamilies={selectedReviewTimingFamilies}
                      selectedYears={selectedReviewTimingYears}
                    />
                  </div>
                </div>
              </div>
            </section>
          </div>

          <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="max-w-2xl">
                  <h2 className="text-lg font-semibold text-white">PR Size Breakdown</h2>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400 xl:justify-end">
                  {AI_PR_SIZE_BUCKETS.map((bucket) => (
                    <CellTooltip key={bucket} tooltip={prSizeLegendTooltip} align="right">
                      <div className="flex cursor-default items-center gap-2">
                        <span
                          className="h-3 w-3 rounded-sm"
                          style={{
                            backgroundColor: SIZE_BUCKET_COLORS[bucket],
                          }}
                          aria-hidden="true"
                        />
                        <span>{PR_SIZE_BUCKET_SHORT_LABELS[bucket]}</span>
                      </div>
                    </CellTooltip>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <YearRow className="min-w-0 flex-1">
                  {availableYears.map((year) => {
                    const isSelected = selectedComparisonYears.includes(year);

                    return (
                      <YearPill
                        key={year}
                        year={year}
                        isSelected={isSelected}
                        onClick={() => toggleComparisonYear(year)}
                      />
                    );
                  })}
                </YearRow>
                <div className="self-start sm:shrink-0">
                  <div className="flex items-center gap-2">
                    <PrSizeMixPivotControlGroup
                      value={prSizeMixValueMode}
                      onChange={(value) => setPrSizeMixValueMode(value as PrSizeMixValueMode)}
                      options={[
                        { value: "mix", label: "% Mix" },
                        { value: "count", label: "Count" },
                      ]}
                    />
                    <PrSizeMixPivotControlGroup
                      value={prSizeMixComparisonMode}
                      onChange={(value) =>
                        setPrSizeMixComparisonMode(value as PrSizeMixComparisonMode)
                      }
                      options={[
                        { value: "priorMonth", label: "MoM" },
                        { value: "sameMonthLastYear", label: "YoY" },
                      ]}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 grid min-w-0 items-start gap-4 2xl:grid-cols-[minmax(0,1.3fr)_minmax(640px,0.7fr)]">
              <div className="min-w-0 rounded-lg bg-white/5 p-4">
                <PrSizeMixComparisonChart
                  points={prSizes.points}
                  selectedYears={selectedComparisonYears}
                  valueMode={prSizeMixValueMode}
                />
              </div>
              <div className="min-w-0">
                {USE_EXPERIMENTAL_PR_SIZE_MIX_TABLE ? (
                  <PrSizeMixPivotDataTable
                    points={prSizes.points}
                    selectedYears={selectedComparisonYears}
                    valueMode={prSizeMixValueMode}
                    comparisonMode={prSizeMixComparisonMode}
                  />
                ) : (
                  <PrSizeMixPivotTable
                    points={prSizes.points}
                    selectedYears={selectedComparisonYears}
                    valueMode={prSizeMixValueMode}
                    comparisonMode={prSizeMixComparisonMode}
                  />
                )}
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <div className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-4">
                <div className="max-w-2xl flex-1">
                  <h2 className="text-lg font-semibold text-white">Review Dynamics</h2>
                </div>
                <div className="ml-auto flex w-fit flex-wrap gap-1 rounded-lg bg-white/5 p-1">
                  {SIZE_REVIEW_MODES.map((option) => (
                    <MetricPill
                      key={option.key}
                      isSelected={reviewBySizeMode === option.key}
                      onClick={() => setReviewBySizeMode(option.key)}
                    >
                      {option.label}
                    </MetricPill>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <YearRow className="min-w-0 flex-1">
                  {availableYears.map((year) => (
                    <YearPill
                      key={year}
                      year={year}
                      isSelected={selectedReviewTimingBySizeYears.includes(year)}
                      onClick={() => toggleReviewTimingBySizeYear(year)}
                    />
                  ))}
                </YearRow>

                <div className="self-start sm:shrink-0">
                  <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
                    {reviewBySizeMode === "timing" ? (
                      <>
                        <div className="flex w-fit flex-nowrap gap-1 rounded-lg bg-white/5 p-1">
                          {REVIEW_TIMING_FAMILIES.map((option) => (
                            <MetricPill
                              key={option.key}
                              isSelected={reviewTimingBySizeFamily === option.key}
                              onClick={() => setReviewTimingBySizeFamily(option.key)}
                            >
                              {option.label}
                            </MetricPill>
                          ))}
                        </div>

                        <div className="flex w-fit flex-nowrap gap-1 rounded-lg bg-white/5 p-1">
                          {REVIEW_TIMING_METRICS.map((option) => (
                            <MetricPill
                              key={option.key}
                              isSelected={reviewTimingBySizeMetric === option.key}
                              onClick={() => setReviewTimingBySizeMetric(option.key)}
                            >
                              {option.label}
                            </MetricPill>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="flex w-fit flex-nowrap gap-1 rounded-lg bg-white/5 p-1">
                        {SIZE_REVIEW_ROUNDS_SCOPES.map((option) => (
                          <MetricPill
                            key={option.key}
                            isSelected={reviewRoundsBySizeScope === option.key}
                            onClick={() => setReviewRoundsBySizeScope(option.key)}
                          >
                            {option.label}
                          </MetricPill>
                        ))}
                      </div>
                    )}

                    <div className="self-end sm:self-auto">
                      <PrSizeMixPivotControlGroup
                        value={reviewTimingBySizeComparisonMode}
                        onChange={(value) =>
                          setReviewTimingBySizeComparisonMode(value as ReviewTimingComparisonMode)
                        }
                        options={[
                          { value: "priorMonth", label: "MoM" },
                          { value: "sameMonthLastYear", label: "YoY" },
                        ]}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="-mt-1 flex flex-wrap gap-2">
                {AI_PR_SIZE_BUCKETS.map((bucket) => {
                  const isSelected = reviewTimingBySizeBuckets.includes(bucket);

                  return (
                    <Button
                      key={bucket}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-auto gap-1.5 px-3 py-1.5 text-xs leading-tight shadow-none"
                      style={getSizeBucketPillStyle(bucket, isSelected)}
                      onClick={() => toggleReviewTimingBySizeBucket(bucket)}
                    >
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: SIZE_BUCKET_COLORS[bucket] }}
                        aria-hidden="true"
                      />
                      {PR_SIZE_BUCKET_SHORT_LABELS[bucket]}
                    </Button>
                  );
                })}
              </div>
            </div>

            <div className="mt-4 grid min-w-0 items-start gap-4 2xl:grid-cols-[minmax(0,1.3fr)_minmax(640px,0.7fr)]">
              <div className="min-w-0 rounded-lg bg-white/5 p-4">
                <div className="h-[336px]">
                  <PrReviewTimingBySizeChart
                    sizePoints={prSizes.points}
                    mode={reviewBySizeMode}
                    timingMetric={reviewTimingBySizeMetric}
                    timingFamily={reviewTimingBySizeFamily}
                    roundsScope={reviewRoundsBySizeScope}
                    selectedYears={selectedReviewTimingBySizeYears}
                    selectedSizeBuckets={reviewTimingBySizeBuckets}
                  />
                </div>
              </div>

              <div className="min-w-0">
                <PrReviewTimingBySizeTable
                  points={prSizes.points}
                  mode={reviewBySizeMode}
                  timingMetric={reviewTimingBySizeMetric}
                  timingFamily={reviewTimingBySizeFamily}
                  roundsScope={reviewRoundsBySizeScope}
                  selectedYears={selectedReviewTimingBySizeYears}
                  comparisonMode={reviewTimingBySizeComparisonMode}
                />
              </div>
            </div>
          </section>

          <div className="grid min-w-0 gap-6 xl:grid-cols-2 xl:items-start">
            <section className="min-w-0 rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="max-w-2xl">
                    <h2 className="text-lg font-semibold text-white">AI-Assisted PRs</h2>
                  </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <YearRow className="min-w-0 flex-1">
                    {aiAssistedAvailableYears.map((year) => (
                      <YearPill
                        key={year}
                        year={year}
                        isSelected={selectedAiAssistedYears.includes(year)}
                        onClick={() => toggleAiAssistedYear(year)}
                      />
                    ))}
                  </YearRow>

                  <div className="self-start sm:shrink-0">
                    <div className="flex w-fit flex-nowrap gap-1 rounded-lg bg-white/5 p-1">
                      {AI_ASSISTED_METRICS.map((option) => (
                        <MetricPill
                          key={option.key}
                          isSelected={aiAssistedMetric === option.key}
                          onClick={() => setAiAssistedMetric(option.key)}
                        >
                          {option.label}
                        </MetricPill>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg bg-white/5 p-4">
                  <div className="h-[320px]">
                    <AiAssistedTrendChart
                      points={aiAssisted.points}
                      modelPoints={aiAssisted.modelPoints}
                      selectedYears={selectedAiAssistedYears}
                      metric={aiAssistedMetric}
                    />
                  </div>
                </div>
              </div>
            </section>

            <div className="hidden xl:block" />
          </div>
        </div>
      </div>
    </div>
  );
}
