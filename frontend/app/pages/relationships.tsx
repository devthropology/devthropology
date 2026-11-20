import { useLoaderData, useLocation, useNavigation, useSearchParams } from "react-router";
import { type MetaFunction } from "react-router";
import { ChevronDown } from "lucide-react";
import { API_URL, authenticatedFetch } from "~/config";
import { EmptyState } from "~/components/ui/EmptyState";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useState, useEffect } from "react";
import type { RelationshipGraphData } from "~/components/RelationshipGraph.client";
import { useCurrentRepoRef } from "~/utils/repositoryRoutes";

const RELATIONSHIP_PERIOD_OPTIONS = [
  { value: "1mo", label: "1 month" },
  { value: "3mo", label: "3 months" },
  { value: "1yr", label: "1 year" },
  { value: "all", label: "All time" },
] as const;

const DEFAULT_MIN_SCORE = "15";

type RelationshipPeriod = (typeof RELATIONSHIP_PERIOD_OPTIONS)[number]["value"];

function isRelationshipPeriod(value: string | null): value is RelationshipPeriod {
  return RELATIONSHIP_PERIOD_OPTIONS.some((option) => option.value === value);
}

export const handle = { appLayoutMode: "fixed" } as const;

export const meta: MetaFunction = () => {
  return [
    { title: "Relationships" },
    {
      name: "description",
      content: "User interaction graph from PR activity",
    },
  ];
};

function getRelevantRelationshipsSearchValue(url: URL): string {
  const params = new URLSearchParams(url.search);
  return params.get("period") ?? "3mo";
}

export function shouldRevalidate({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}: {
  currentUrl: URL;
  nextUrl: URL;
  defaultShouldRevalidate: boolean;
}) {
  if (currentUrl.pathname === nextUrl.pathname) {
    const currentPeriod = getRelevantRelationshipsSearchValue(currentUrl);
    const nextPeriod = getRelevantRelationshipsSearchValue(nextUrl);

    if (currentPeriod === nextPeriod) {
      return false;
    }
  }

  return defaultShouldRevalidate;
}

export async function loadRelationshipsData(
  request: Request,
  userToken: string,
  repositoryId: string,
) {
  const requestUrl = new URL(request.url);
  const periodParam = requestUrl.searchParams.get("period");
  const period: RelationshipPeriod = isRelationshipPeriod(periodParam) ? periodParam : "3mo";

  if (!repositoryId) {
    return { graph: { nodes: [], edges: [] } as RelationshipGraphData, period };
  }

  const url = `${API_URL}/api/repository/${repositoryId}/relationships?period=${period}`;

  try {
    const response = await authenticatedFetch(url, userToken, {
      request,
    });
    if (!response.ok) {
      console.error("Failed to fetch relationships:", response.status);
      return { graph: { nodes: [], edges: [] } as RelationshipGraphData, period };
    }
    const graph: RelationshipGraphData = await response.json();
    return { graph, period };
  } catch (error) {
    console.error("Error fetching relationship graph:", error);
    return { graph: { nodes: [], edges: [] } as RelationshipGraphData, period };
  }
}

export type RelationshipsLoaderData = Awaited<ReturnType<typeof loadRelationshipsData>>;

export default function Relationships() {
  const { graph, period } = useLoaderData<RelationshipsLoaderData>();
  const location = useLocation();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const repoRef = useCurrentRepoRef();

  // Client-only gate: the graph component imports WebGL libs (sigma)
  // that cannot run during SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const searchParamPeriod = searchParams.get("period");
  const selectedPeriod: RelationshipPeriod = (() => {
    if (isRelationshipPeriod(searchParamPeriod)) {
      return searchParamPeriod;
    }
    return period;
  })();
  const selectedPeriodLabel =
    RELATIONSHIP_PERIOD_OPTIONS.find((option) => option.value === selectedPeriod)?.label ??
    "3 months";

  const pendingPeriod = navigation.location
    ? getRelevantRelationshipsSearchValue(
        new URL(`${navigation.location.pathname}${navigation.location.search}`, "http://local"),
      )
    : null;

  const isPeriodLoading =
    navigation.state === "loading" &&
    Boolean(navigation.location) &&
    (navigation.location?.pathname !== location.pathname || pendingPeriod !== selectedPeriod);

  useEffect(() => {
    if (!searchParams.has("period") || !searchParams.has("w")) {
      const nextSearchParams = new URLSearchParams(searchParams);
      if (!searchParams.has("period")) {
        nextSearchParams.set("period", period);
      }
      if (!searchParams.has("w")) {
        nextSearchParams.set("w", DEFAULT_MIN_SCORE);
      }
      setSearchParams(nextSearchParams, { replace: true });
    }
  }, [period, searchParams, setSearchParams]);

  // Lazy-load the client component only after mount
  const [GraphComponent, setGraphComponent] = useState<React.ComponentType<{
    graph: RelationshipGraphData;
  }> | null>(null);

  useEffect(() => {
    if (!mounted) return;
    void import("~/components/RelationshipGraph.client").then((mod) => {
      setGraphComponent(() => mod.RelationshipGraphView);
    });
  }, [mounted]);

  const handlePeriodChange = (nextPeriod: RelationshipPeriod) => {
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.set("period", nextPeriod);
    setSearchParams(nextSearchParams);
  };

  return (
    <div className="font-sans text-white h-full min-h-0 flex flex-col">
      <div className="flex-shrink-0 border-b border-white/10">
        <div className="flex min-h-16 items-center justify-between gap-4 py-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Relationships</h1>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={isPeriodLoading}>
              <button
                type="button"
                className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 bg-gray-800/70 px-3 text-sm font-medium text-gray-100 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Relationships timeframe"
              >
                <span>{selectedPeriodLabel}</span>
                <ChevronDown className="h-4 w-4 text-gray-400" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="min-w-[10rem] border-gray-700 bg-gray-800 text-gray-100"
            >
              {RELATIONSHIP_PERIOD_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onSelect={() => handlePeriodChange(option.value)}
                  className={selectedPeriod === option.value ? "bg-gray-700" : ""}
                >
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {graph.nodes.length === 0 ? (
          <EmptyState message="No relationship data available. Run a sync to populate interaction data." />
        ) : GraphComponent ? (
          <GraphComponent key={`${repoRef ?? "legacy"}:${period}`} graph={graph} />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            Loading graph...
          </div>
        )}
      </div>
    </div>
  );
}
