/**
 * Client-only relationship graph visualization using sigma.js + graphology.
 *
 * This file uses the `.client.tsx` Remix convention so it is NEVER evaluated
 * during SSR — allowing top-level imports of WebGL-dependent libraries.
 */
import { Link, useSearchParams } from "react-router";
import { Search, X } from "lucide-react";
import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import {
  createEdgeArrowProgram,
  createEdgeDoubleArrowProgram,
  type NodeHoverDrawingFunction,
} from "sigma/rendering";
import louvain from "graphology-communities-louvain";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { circular } from "graphology-layout";
import { RelationshipScoreList } from "./RelationshipScoreList";
import {
  formatInteger,
  getFeedbackFlowSummary,
  getNodeScoreContext,
  getRelationshipMetrics,
  type RelationshipEdgeData,
  type RelationshipNodeSummary,
} from "./relationshipGraphUtils";
import { cn } from "~/lib/utils";
import { buildContributorPath, useCurrentRepoRef } from "../utils/repositoryRoutes";

// ── Types ────────────────────────────────────────────────────────────

export interface EdgeData extends RelationshipEdgeData {}

export interface GraphNode extends RelationshipNodeSummary {}

export interface GraphEdge {
  fromUserId: number;
  toUserId: number;
  weight: number;
  edgeData: EdgeData;
}

export interface RelationshipGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ── Constants ────────────────────────────────────────────────────────

const COMMUNITY_COLORS = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#84cc16", // lime
  "#f97316", // orange
  "#6366f1", // indigo
  "#14b8a6", // teal
  "#e879f9", // fuchsia
];

const COMMUNITY_RESOLUTION = 1;
const DEFAULT_MIN_SCORE = 15;
const ArrowProgram = createEdgeArrowProgram({ lengthToThicknessRatio: 4 });
const DoubleArrowProgram = createEdgeDoubleArrowProgram({ lengthToThicknessRatio: 4 });

interface DirectionalEdgeDetail {
  fromLogin: string;
  toLogin: string;
  weight: number;
  edgeData: EdgeData;
}

type SelectedEdge =
  | { kind: "single"; detail: DirectionalEdgeDetail }
  | { kind: "double"; details: [DirectionalEdgeDetail, DirectionalEdgeDetail] };

// ── Helpers ──────────────────────────────────────────────────────────

function parseMinScoreParam(value: string | null): number {
  if (value === null) return DEFAULT_MIN_SCORE;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? DEFAULT_MIN_SCORE : Math.max(0, parsed);
}

function clampMinScore(value: number, maxScore: number): number {
  return Math.max(0, Math.min(maxScore, value));
}

function readSelectedUserFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("user");
}

function debugRelationships(message: string, payload: unknown): void {
  if (!import.meta.env.DEV) return;
  console.log(message, payload);
}

const disableNodeHover: NodeHoverDrawingFunction = () => {};

function RelationshipMetricsGrid({ edgeData }: { edgeData: EdgeData }) {
  const items = getRelationshipMetrics(edgeData);

  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map(({ label, value }) => (
        <div key={label} className="rounded-md border border-white/5 bg-white/[0.03] px-2.5 py-2">
          <div className="text-[11px] text-gray-400">{label}</div>
          <div className="mt-1 text-sm font-medium tabular-nums text-white">
            {formatInteger(value)}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Build a graphology Graph from API data with Louvain community
 * detection and ForceAtlas2 initial layout.
 */
function buildGraphologyGraph(graphData: RelationshipGraphData, minWeight: number): Graph {
  const graph = new Graph({ type: "directed" });

  const filteredEdges = graphData.edges.filter((e) => e.weight >= minWeight);
  const activeNodeIds = new Set<number>();
  for (const e of filteredEdges) {
    activeNodeIds.add(e.fromUserId);
    activeNodeIds.add(e.toUserId);
  }
  const filteredNodes = graphData.nodes.filter((n) => activeNodeIds.has(n.userId));

  if (filteredNodes.length === 0) return graph;

  const globalMaxEdgeWeight = Math.max(1, ...graphData.edges.map((e) => e.weight));
  const maxNodeWeight = Math.max(
    1,
    ...filteredNodes.map((n) => n.totalInWeight + n.totalOutWeight),
  );

  // Build a quick lookup for login names
  const loginById = new Map<number, string>();
  for (const n of filteredNodes) loginById.set(n.userId, n.ghLogin);

  // Add nodes
  for (const node of filteredNodes) {
    const totalWeight = node.totalInWeight + node.totalOutWeight;
    const sizeScale = Math.max(4, 4 + (totalWeight / maxNodeWeight) * 16);
    graph.addNode(`n${node.userId}`, {
      label: node.ghLogin,
      size: sizeScale,
      userId: node.userId,
      totalInWeight: node.totalInWeight,
      totalOutWeight: node.totalOutWeight,
      x: 0,
      y: 0,
    });
  }

  // Add edges, merging reciprocal relationships into one double-arrow edge.
  const edgeByDirection = new Map<string, GraphEdge>();
  const processedPairs = new Set<string>();

  for (const edge of filteredEdges) {
    edgeByDirection.set(`${edge.fromUserId}->${edge.toUserId}`, edge);
  }

  for (const edge of filteredEdges) {
    const sourceNodeKey = `n${edge.fromUserId}`;
    const targetNodeKey = `n${edge.toUserId}`;
    const reverse = edgeByDirection.get(`${edge.toUserId}->${edge.fromUserId}`);

    if (reverse) {
      const pairKey = [edge.fromUserId, edge.toUserId].sort((a, b) => a - b).join("<->");
      if (processedPairs.has(pairKey)) continue;
      processedPairs.add(pairKey);

      const primary = edge.fromUserId <= edge.toUserId ? edge : reverse;
      const secondary = edge.fromUserId <= edge.toUserId ? reverse : edge;
      const widthScale = Math.max(
        1.5,
        1.5 + (Math.max(primary.weight, secondary.weight) / globalMaxEdgeWeight) * 4,
      );

      graph.addEdge(`n${primary.fromUserId}`, `n${primary.toUserId}`, {
        type: "doubleArrow",
        weight: Math.max(primary.weight, secondary.weight),
        size: widthScale,
        isBidirectional: true,
        primaryFromLogin: loginById.get(primary.fromUserId) ?? "",
        primaryToLogin: loginById.get(primary.toUserId) ?? "",
        primaryWeight: primary.weight,
        primaryEdgeData: primary.edgeData,
        secondaryFromLogin: loginById.get(secondary.fromUserId) ?? "",
        secondaryToLogin: loginById.get(secondary.toUserId) ?? "",
        secondaryWeight: secondary.weight,
        secondaryEdgeData: secondary.edgeData,
      });

      continue;
    }

    const widthScale = Math.max(1.5, 1.5 + (edge.weight / globalMaxEdgeWeight) * 4);
    graph.addEdge(sourceNodeKey, targetNodeKey, {
      type: "arrow",
      weight: edge.weight,
      size: widthScale,
      edgeData: edge.edgeData,
      isBidirectional: false,
      fromUserId: edge.fromUserId,
      toUserId: edge.toUserId,
      fromLogin: loginById.get(edge.fromUserId) ?? "",
      toLogin: loginById.get(edge.toUserId) ?? "",
    });
  }

  // Louvain community detection
  try {
    louvain.assign(graph, {
      nodeCommunityAttribute: "community",
      resolution: COMMUNITY_RESOLUTION,
      getEdgeWeight: "weight",
    });
  } catch {
    graph.forEachNode((node) => {
      graph.setNodeAttribute(node, "community", 0);
    });
  }

  // Assign colors by community
  graph.forEachNode((node) => {
    const community = (graph.getNodeAttribute(node, "community") as number) ?? 0;
    graph.setNodeAttribute(node, "color", COMMUNITY_COLORS[community % COMMUNITY_COLORS.length]);
  });

  // Layout: circular seed → synchronous FA2 refinement
  circular.assign(graph, { scale: 100 });
  const fa2Settings = forceAtlas2.inferSettings(graph);
  forceAtlas2.assign(graph, {
    settings: { ...fa2Settings, gravity: 1, slowDown: 10 },
    iterations: 200,
    getEdgeWeight: "weight",
  });

  return graph;
}

// ── Detail panels ────────────────────────────────────────────────────

function EdgeDetailPanel({
  edge,
  onClose,
  className,
}: {
  edge: SelectedEdge;
  onClose: () => void;
  className?: string;
}) {
  const renderMetrics = (detail: DirectionalEdgeDetail) => {
    return (
      <div className="rounded-lg border border-white/10 bg-slate-950/30 p-3">
        <div className="text-xs text-gray-300 mb-2">
          <span className="text-blue-400 font-medium">{detail.fromLogin}</span>
          <span className="mx-1.5 text-gray-500">&rarr;</span>
          <span className="text-emerald-400 font-medium">{detail.toLogin}</span>
        </div>
        <div className="text-sm font-medium text-white mb-3">
          Relationship score: {formatInteger(detail.weight)}
        </div>
        <RelationshipMetricsGrid edgeData={detail.edgeData} />
      </div>
    );
  };

  return (
    <div
      className={cn(
        "w-full max-w-[20rem] sm:max-w-80 rounded-lg border border-white/10 bg-gray-800/95 p-4 shadow-xl backdrop-blur-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">Connection Detail</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>
      {edge.kind === "single" ? (
        renderMetrics(edge.detail)
      ) : (
        <div className="space-y-3">
          <div className="text-xs text-gray-400">
            Mutual feedback between {edge.details[0].fromLogin} and {edge.details[0].toLogin}
          </div>
          {edge.details.map((detail) => (
            <div key={`${detail.fromLogin}-${detail.toLogin}`}>{renderMetrics(detail)}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function NodeDetailPanel({
  node,
  edges,
  allNodes,
  nodeMap,
  onClose,
  className,
}: {
  node: GraphNode;
  edges: GraphEdge[];
  allNodes: GraphNode[];
  nodeMap: Map<number, GraphNode>;
  onClose: () => void;
  className?: string;
}) {
  const outgoing = useMemo(
    () => edges.filter((e) => e.fromUserId === node.userId).sort((a, b) => b.weight - a.weight),
    [edges, node.userId],
  );
  const incoming = useMemo(
    () => edges.filter((e) => e.toUserId === node.userId).sort((a, b) => b.weight - a.weight),
    [edges, node.userId],
  );
  const totalScore = node.totalInWeight + node.totalOutWeight;
  const repoRef = useCurrentRepoRef();
  const { rank, totalNodes, topPercent } = useMemo(
    () => getNodeScoreContext(node, allNodes),
    [allNodes, node],
  );
  const feedbackFlowSummary = getFeedbackFlowSummary(node.totalOutWeight, node.totalInWeight);

  return (
    <div
      className={cn(
        "relationship-scroll-area max-h-[90dvh] w-full max-w-[36rem] overflow-y-auto rounded-lg border border-white/[0.08] bg-gray-800/95 p-3 shadow-xl backdrop-blur-sm sm:p-4",
        className,
      )}
    >
      <div className="mb-2 flex items-center justify-between sm:mb-3">
        <h3 className="text-xs font-semibold text-white sm:text-sm">Relationship Profile</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mb-3 border-b border-white/[0.08] pb-3 sm:mb-4 sm:pb-4">
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <Link
            to={buildContributorPath(node.ghLogin, repoRef ?? undefined)}
            className="inline-block text-sm font-semibold leading-tight text-white transition-colors hover:text-blue-300"
          >
            {node.ghLogin}
          </Link>
          <div className="text-left leading-tight sm:text-right">
            <span className="text-sm font-medium text-gray-400">Score: </span>
            <span className="text-sm font-bold text-white">{formatInteger(totalScore)}</span>
          </div>

          <div className="text-sm font-medium text-gray-300">
            <span className="text-blue-300">{formatInteger(node.totalOutWeight)}</span> sent
            <span className="mx-1.5 text-gray-600">&bull;</span>
            <span className="text-emerald-300">{formatInteger(node.totalInWeight)}</span> received
          </div>
          {totalNodes > 1 ? (
            <div className="text-sm font-medium text-gray-400 sm:text-right">
              Top {topPercent}%<span className="mx-1.5 text-gray-600">&bull;</span>#
              {formatInteger(rank)} of {formatInteger(totalNodes)}
            </div>
          ) : (
            <div />
          )}

          <div className="text-sm font-medium text-gray-300">{feedbackFlowSummary}</div>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <RelationshipScoreList
          title="Gives feedback to"
          rows={outgoing}
          getLogin={(edge) => nodeMap.get(edge.toUserId)?.ghLogin ?? String(edge.toUserId)}
        />
        <RelationshipScoreList
          title="Gets feedback from"
          rows={incoming}
          getLogin={(edge) => nodeMap.get(edge.fromUserId)?.ghLogin ?? String(edge.fromUserId)}
        />
      </div>
    </div>
  );
}

// ── Main graph component ─────────────────────────────────────────────

// Desktop behavior intentionally shifts the graph container instead of moving
// the Sigma camera. The flyout overlap math is easier to reason about in screen
// space, and closing the flyout preserves the current graph view.
export function RelationshipGraphView({ graph: graphData }: { graph: RelationshipGraphData }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const desktopDetailRef = useRef<HTMLDivElement>(null);

  const [searchParams, setSearchParams] = useSearchParams();
  // Read initial values from URL (on mount only)
  const initialWeight = useRef(parseMinScoreParam(searchParams.get("w"))).current;
  const hadInitialWeightParam = useRef(searchParams.has("w")).current;

  // Local state
  const [searchQuery, setSearchQueryLocal] = useState("");
  const [localMinWeight, setLocalMinWeight] = useState(initialWeight);
  const [selectedUserLogin, setSelectedUserLogin] = useState<string | null>(() =>
    readSelectedUserFromUrl(),
  );

  const weightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Highlighted state for reducers — use refs so sigma closures read current values
  const [highlightedNode, setHighlightedNode] = useState<string | null>(null);
  const highlightedNodeRef = useRef(highlightedNode);
  highlightedNodeRef.current = highlightedNode;

  const [selectedEdge, setSelectedEdge] = useState<SelectedEdge | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [graphShiftPx, setGraphShiftPx] = useState(0);
  const [minWeightInput, setMinWeightInput] = useState(() => String(initialWeight));

  const replaceSelectedUserInUrl = useCallback((login: string | null) => {
    if (typeof window === "undefined") return;
    const nextUrl = new URL(window.location.href);
    if (login) {
      nextUrl.searchParams.set("user", login);
    } else {
      nextUrl.searchParams.delete("user");
    }
    window.history.replaceState(window.history.state, "", nextUrl);
  }, []);

  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;

  // Lookup maps
  const nodeMap = useMemo(() => {
    const map = new Map<number, GraphNode>();
    for (const n of graphData.nodes) {
      map.set(n.userId, n);
    }
    return map;
  }, [graphData.nodes]);

  const globalMaxEdgeWeight = useMemo(
    () => Math.max(1, ...graphData.edges.map((e) => e.weight)),
    [graphData.edges],
  );

  // Filtered counts for display
  const filteredEdges = useMemo(
    () => graphData.edges.filter((e) => e.weight >= localMinWeight),
    [graphData.edges, localMinWeight],
  );
  const activeNodeIds = useMemo(() => {
    const ids = new Set<number>();
    for (const e of filteredEdges) {
      ids.add(e.fromUserId);
      ids.add(e.toUserId);
    }
    return ids;
  }, [filteredEdges]);
  const filteredNodeCount = useMemo(
    () => graphData.nodes.filter((n) => activeNodeIds.has(n.userId)).length,
    [graphData.nodes, activeNodeIds],
  );

  const [communityCount, setCommunityCount] = useState(0);

  useEffect(() => {
    setSelectedNode(null);
    setSelectedEdge(null);
    setHighlightedNode(null);
    setGraphShiftPx(0);
  }, [graphData]);

  useEffect(() => {
    if (!selectedUserLogin) {
      setSelectedNode(null);
      setHighlightedNode(null);
      setGraphShiftPx(0);
      return;
    }

    const matchedNode = graphData.nodes.find((node) => node.ghLogin === selectedUserLogin);
    const isActiveNode = matchedNode ? activeNodeIds.has(matchedNode.userId) : false;

    if (!matchedNode || !isActiveNode) {
      setSelectedUserLogin(null);
      replaceSelectedUserInUrl(null);
      setSelectedNode(null);
      setHighlightedNode(null);
      setGraphShiftPx(0);
      return;
    }

    const highlightedKey = `n${matchedNode.userId}`;
    setSelectedNode((current) => (current?.userId === matchedNode.userId ? current : matchedNode));
    setHighlightedNode((current) => (current === highlightedKey ? current : highlightedKey));
  }, [activeNodeIds, graphData.nodes, replaceSelectedUserInUrl, selectedUserLogin]);

  // Sync local graph controls to the URL while the route opts out of
  // revalidation for q/w-only changes.
  const syncUrlParams = useCallback(
    (w: number) => {
      const nextSearchParams = new URLSearchParams(searchParams);
      nextSearchParams.delete("q");
      nextSearchParams.set("w", String(Math.max(0, w)));

      if (nextSearchParams.toString() === searchParams.toString()) {
        return;
      }

      setSearchParams(nextSearchParams, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  useEffect(() => {
    if (!hadInitialWeightParam) {
      syncUrlParams(initialWeight);
    }
  }, [hadInitialWeightParam, initialWeight, syncUrlParams]);

  useEffect(() => {
    setLocalMinWeight((current) => {
      const nextWeight = clampMinScore(current, globalMaxEdgeWeight);
      if (nextWeight !== current) {
        syncUrlParams(nextWeight);
      }
      return nextWeight;
    });
  }, [globalMaxEdgeWeight, syncUrlParams]);

  const setMinWeight = useCallback(
    (w: number) => {
      const nextWeight = clampMinScore(w, globalMaxEdgeWeight);
      setLocalMinWeight(nextWeight);
      setMinWeightInput(String(nextWeight));
      if (weightTimerRef.current) clearTimeout(weightTimerRef.current);
      weightTimerRef.current = setTimeout(() => syncUrlParams(nextWeight), 300);
    },
    [globalMaxEdgeWeight, syncUrlParams],
  );

  useEffect(() => {
    setMinWeightInput(String(localMinWeight));
  }, [localMinWeight]);

  const commitMinWeightInput = useCallback(() => {
    if (minWeightInput.trim() === "") {
      setMinWeight(0);
      return;
    }

    const nextWeight = Number.parseInt(minWeightInput, 10);
    if (Number.isNaN(nextWeight)) {
      setMinWeightInput(String(localMinWeight));
      return;
    }

    setMinWeight(nextWeight);
  }, [localMinWeight, minWeightInput, setMinWeight]);

  const closeNodeDetail = useCallback(() => {
    setSelectedUserLogin(null);
    replaceSelectedUserInUrl(null);
    setSelectedNode(null);
    setHighlightedNode(null);
    setGraphShiftPx(0);
  }, [replaceSelectedUserInUrl]);

  const closeEdgeDetail = useCallback(() => {
    setSelectedEdge(null);
    setGraphShiftPx(0);
  }, []);

  // ── Build graph + sigma ──────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const graph = buildGraphologyGraph(graphData, localMinWeight);

    // Count communities
    const communities = new Set<number>();
    graph.forEachNode((_node, attrs) => {
      communities.add((attrs.community as number) ?? 0);
    });
    setCommunityCount(communities.size);

    // Create sigma renderer
    const renderer = new Sigma(graph, containerRef.current, {
      defaultEdgeType: "arrow",
      edgeProgramClasses: {
        arrow: ArrowProgram,
        doubleArrow: DoubleArrowProgram,
      },
      defaultNodeColor: "#3b82f6",
      defaultEdgeColor: "#6b7280",
      labelColor: { color: "#e5e7eb" },
      labelSize: 12,
      labelRenderedSizeThreshold: 6,
      defaultDrawNodeHover: disableNodeHover,
      nodeReducer: (node, data) => {
        const res = { ...data };
        const query = searchQueryRef.current?.toLowerCase();
        const hNode = highlightedNodeRef.current;

        if (hNode) {
          if (node === hNode) {
            res.color = "#f59e0b";
            res.zIndex = 2;
          } else if (graph.areNeighbors(node, hNode)) {
            res.zIndex = 1;
          } else {
            res.color = "#333333";
            res.label = "";
            res.zIndex = 0;
          }
        } else if (query) {
          const label = ((data.label as string) ?? "").toLowerCase();
          if (label.includes(query)) {
            res.color = "#f59e0b";
            res.zIndex = 2;
          } else {
            let isNeighbor = false;
            graph.forEachNeighbor(node, (neighbor) => {
              const nLabel = (
                (graph.getNodeAttribute(neighbor, "label") as string) ?? ""
              ).toLowerCase();
              if (nLabel.includes(query)) isNeighbor = true;
            });
            if (!isNeighbor) {
              res.color = "#333333";
              res.label = "";
              res.zIndex = 0;
            }
          }
        }

        return res;
      },
      edgeReducer: (edge, data) => {
        const res = { ...data };
        const isBidirectional = graph.getEdgeAttribute(edge, "isBidirectional");
        res.color = isBidirectional ? "#10b981" : "#6b7280";

        const query = searchQueryRef.current?.toLowerCase();
        const hNode = highlightedNodeRef.current;

        if (hNode) {
          const source = graph.source(edge);
          const target = graph.target(edge);
          if (source === hNode || target === hNode) {
            res.color = "#f59e0b";
            res.zIndex = 1;
          } else {
            res.color = "#1a1a1a";
            res.zIndex = 0;
          }
        } else if (query) {
          const source = graph.source(edge);
          const target = graph.target(edge);
          const srcLabel = (
            (graph.getNodeAttribute(source, "label") as string) ?? ""
          ).toLowerCase();
          const tgtLabel = (
            (graph.getNodeAttribute(target, "label") as string) ?? ""
          ).toLowerCase();
          if (srcLabel.includes(query) || tgtLabel.includes(query)) {
            res.color = "#f59e0b";
            res.zIndex = 1;
          } else {
            res.color = "#1a1a1a";
            res.zIndex = 0;
          }
        }

        return res;
      },
      enableEdgeEvents: true,
      stagePadding: 40,
      zIndex: true,
    });

    sigmaRef.current = renderer;
    graphRef.current = graph;

    // Node click
    renderer.on("clickNode", ({ node }) => {
      const attrs = graph.getNodeAttributes(node);
      const gNode = nodeMap.get(attrs.userId as number);
      const display = (
        renderer as Sigma & {
          getNodeDisplayData?: (node: string) => { x: number; y: number; size?: number } | null;
        }
      ).getNodeDisplayData?.(node);
      const containerRect = containerRef.current?.getBoundingClientRect();
      const viewport = renderer.graphToViewport({
        x: attrs.x as number,
        y: attrs.y as number,
      });

      if (containerRect) {
        debugRelationships("[relationships] node click", {
          node,
          ghLogin: gNode?.ghLogin ?? attrs.label,
          userId: attrs.userId,
          graph: {
            x: attrs.x,
            y: attrs.y,
          },
          viewport: {
            x: viewport.x,
            y: viewport.y,
            size: display?.size ?? null,
          },
          container: {
            left: containerRect.left,
            top: containerRect.top,
            width: containerRect.width,
            height: containerRect.height,
          },
          page: {
            x: containerRect.left + viewport.x,
            y: containerRect.top + viewport.y,
          },
          distanceToContainerEdges: {
            left: viewport.x,
            right: containerRect.width - viewport.x,
            top: viewport.y,
            bottom: containerRect.height - viewport.y,
          },
        });
      }

      if (highlightedNodeRef.current === node) {
        setSelectedUserLogin(null);
        replaceSelectedUserInUrl(null);
        setHighlightedNode(null);
        setSelectedNode(null);
        setSelectedEdge(null);
        setGraphShiftPx(0);
      } else {
        setHighlightedNode(node);
        if (gNode) {
          setSelectedUserLogin(gNode.ghLogin);
          replaceSelectedUserInUrl(gNode.ghLogin);
          setSelectedNode(gNode);
          setSelectedEdge(null);
        }
      }
    });

    // Edge click
    renderer.on("clickEdge", ({ edge }) => {
      const attrs = graph.getEdgeAttributes(edge);
      if (attrs.isBidirectional) {
        setSelectedEdge({
          kind: "double",
          details: [
            {
              fromLogin: attrs.primaryFromLogin as string,
              toLogin: attrs.primaryToLogin as string,
              weight: attrs.primaryWeight as number,
              edgeData: attrs.primaryEdgeData as EdgeData,
            },
            {
              fromLogin: attrs.secondaryFromLogin as string,
              toLogin: attrs.secondaryToLogin as string,
              weight: attrs.secondaryWeight as number,
              edgeData: attrs.secondaryEdgeData as EdgeData,
            },
          ],
        });
      } else {
        setSelectedEdge({
          kind: "single",
          detail: {
            fromLogin: attrs.fromLogin as string,
            toLogin: attrs.toLogin as string,
            weight: attrs.weight as number,
            edgeData: attrs.edgeData as EdgeData,
          },
        });
      }
      setSelectedUserLogin(null);
      replaceSelectedUserInUrl(null);
      setSelectedNode(null);
      setHighlightedNode(null);
    });

    // Background click
    renderer.on("clickStage", () => {
      setSelectedUserLogin(null);
      replaceSelectedUserInUrl(null);
      setSelectedNode(null);
      setSelectedEdge(null);
      setHighlightedNode(null);
      setGraphShiftPx(0);
    });

    return () => {
      renderer.kill();
      sigmaRef.current = null;
      graphRef.current = null;
    };
  }, [graphData, localMinWeight, replaceSelectedUserInUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh sigma when highlight/search state changes (no rebuild)
  useEffect(() => {
    sigmaRef.current?.refresh();
  }, [highlightedNode, searchQuery]);

  useEffect(() => {
    if (!selectedNode || !window.matchMedia("(min-width: 1280px)").matches) return;

    const renderer = sigmaRef.current;
    const graph = graphRef.current;
    const containerRect = containerRef.current?.getBoundingClientRect();
    const panelEl = desktopDetailRef.current;
    if (!renderer || !graph || !containerRect || !panelEl) return;

    const frame = window.requestAnimationFrame(() => {
      const panelRect = panelEl.getBoundingClientRect();
      const selectedNodeKey = `n${selectedNode.userId}`;
      const relatedNodeKeys = new Set<string>([selectedNodeKey]);

      graph.forEachNeighbor(selectedNodeKey, (neighbor) => {
        relatedNodeKeys.add(neighbor);
      });

      const sigmaRenderer = renderer as Sigma & {
        getNodeDisplayData?: (node: string) => { x: number; y: number; size?: number } | null;
      };

      const relatedNodes = [...relatedNodeKeys]
        .map((nodeKey) => {
          const display = sigmaRenderer.getNodeDisplayData?.(nodeKey);
          const attrs = graph.getNodeAttributes(nodeKey);
          const viewport = renderer.graphToViewport({
            x: attrs.x as number,
            y: attrs.y as number,
          });
          if (!display) return null;

          const radius = Math.max(8, display.size ?? 0);
          const pageX = containerRect.left + viewport.x;
          const pageY = containerRect.top + viewport.y;
          const bounds = {
            left: pageX - radius,
            right: pageX + radius,
            top: pageY - radius,
            bottom: pageY + radius,
          };
          const isCovered = !(
            bounds.right < panelRect.left ||
            bounds.left > panelRect.right ||
            bounds.bottom < panelRect.top ||
            bounds.top > panelRect.bottom
          );

          return {
            nodeKey,
            ghLogin: (graph.getNodeAttribute(nodeKey, "label") as string | undefined) ?? nodeKey,
            isSelected: nodeKey === selectedNodeKey,
            graph: {
              x: attrs.x as number,
              y: attrs.y as number,
            },
            viewport: {
              x: viewport.x,
              y: viewport.y,
              size: radius,
            },
            page: {
              x: pageX,
              y: pageY,
            },
            bounds,
            isCovered,
          };
        })
        .filter((node): node is NonNullable<typeof node> => node !== null);
      const coveredNodes = relatedNodes.filter((node) => node.isCovered);

      debugRelationships("[relationships] selected node related positions", {
        selectedNode: selectedNode.ghLogin,
        panelBounds: {
          left: panelRect.left,
          right: panelRect.right,
          top: panelRect.top,
          bottom: panelRect.bottom,
          width: panelRect.width,
          height: panelRect.height,
        },
        coveredNodes: coveredNodes.map((node) => ({
          ghLogin: node.ghLogin,
          isSelected: node.isSelected,
          viewport: node.viewport,
          page: node.page,
        })),
        relatedNodes,
      });

      const panelPadding = 24;
      const maxCoveredRight = coveredNodes.reduce(
        (max, node) => Math.max(max, node.bounds.right),
        Number.NEGATIVE_INFINITY,
      );
      const overlapPx =
        coveredNodes.length > 0
          ? Math.max(0, maxCoveredRight - (panelRect.left - panelPadding))
          : 0;
      const nextShift = overlapPx > 0 ? -Math.ceil(overlapPx) : 0;
      setGraphShiftPx((current) => (current === nextShift ? current : nextShift));
      debugRelationships("[relationships] computed shift result", {
        selectedNode: selectedNode.ghLogin,
        coveredCount: coveredNodes.length,
        maxCoveredRight,
        overlapPx,
        shiftPx: nextShift,
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [selectedNode]);

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      {/* Detail panels overlay (Mobile only) */}
      {selectedEdge && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-gray-950/40 p-4 backdrop-blur-sm xl:hidden">
          <div className="mx-auto h-full w-full max-w-lg overflow-hidden">
            <EdgeDetailPanel
              edge={selectedEdge}
              onClose={closeEdgeDetail}
              className="max-h-full w-full shadow-2xl"
            />
          </div>
        </div>
      )}
      {selectedNode && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-gray-950/40 p-4 backdrop-blur-sm xl:hidden">
          <div className="mx-auto h-full w-full max-w-lg overflow-hidden">
            <NodeDetailPanel
              key={selectedNode.userId}
              node={selectedNode}
              edges={graphData.edges}
              allNodes={graphData.nodes}
              nodeMap={nodeMap}
              onClose={closeNodeDetail}
              className="max-h-full w-full shadow-2xl"
            />
          </div>
        </div>
      )}

      {/* Controls bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 px-4 pt-4">
        {/* Search input */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          <input
            type="text"
            placeholder="Search users..."
            value={searchQuery}
            onChange={(e) => setSearchQueryLocal(e.target.value)}
            className="h-8 w-48 rounded-md border border-white/10 bg-gray-800/90 backdrop-blur-sm pl-8 pr-3 text-xs text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500/50"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQueryLocal("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Min score slider + stepper */}
        <div className="flex items-center gap-2 rounded-md border border-white/10 bg-gray-800/90 backdrop-blur-sm px-3 h-8">
          <label className="text-xs text-gray-400 whitespace-nowrap">Minimum score</label>
          <input
            type="range"
            min={0}
            max={globalMaxEdgeWeight}
            step={1}
            value={localMinWeight}
            onChange={(e) => setMinWeight(parseInt(e.target.value, 10))}
            className="w-24 accent-blue-500"
          />
          <div className="flex items-center">
            <button
              onClick={() => setMinWeight(Math.max(0, localMinWeight - 1))}
              className="px-1.5 text-gray-400 hover:text-white transition-colors text-sm font-mono leading-none"
              aria-label="Decrease min score"
            >
              &minus;
            </button>
            <input
              type="number"
              min={0}
              max={globalMaxEdgeWeight}
              value={minWeightInput}
              onChange={(e) => {
                setMinWeightInput(e.target.value);
              }}
              onBlur={commitMinWeightInput}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  commitMinWeightInput();
                  e.currentTarget.blur();
                }
              }}
              className="w-10 text-center text-xs text-gray-200 bg-transparent tabular-nums focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <button
              onClick={() => setMinWeight(Math.min(globalMaxEdgeWeight, localMinWeight + 1))}
              className="px-1.5 text-gray-400 hover:text-white transition-colors text-sm font-mono leading-none"
              aria-label="Increase min score"
            >
              +
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-3 rounded-md border border-white/10 bg-gray-800/90 backdrop-blur-sm px-3 h-8 text-xs text-gray-400">
          <span>
            <span className="text-gray-200">{filteredNodeCount}</span> nodes
          </span>
          <span>
            <span className="text-gray-200">{filteredEdges.length}</span> edges
          </span>
          <span>
            <span className="text-gray-200">{communityCount}</span> communities
          </span>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 rounded-md border border-white/10 bg-gray-800/90 backdrop-blur-sm px-3 h-8 text-xs text-gray-400">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 h-0.5 bg-emerald-500" />
            bidirectional
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 h-0.5 bg-gray-500" />
            one-way
          </span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-4 px-4 pb-4 pt-2">
        <div className="relative min-h-0 min-w-0 flex-1">
          {/* Sigma container — needs explicit dimensions for WebGL canvas */}
          <div
            ref={containerRef}
            className="h-full w-full transition-transform duration-200"
            style={{ minHeight: "400px", transform: `translateX(${graphShiftPx}px)` }}
          />

          {(selectedEdge || selectedNode) && (
            <div className="pointer-events-none absolute right-4 top-4 z-20 hidden xl:block">
              <div ref={desktopDetailRef} className="pointer-events-auto">
                {selectedEdge && (
                  <div className="w-80 max-w-[min(24rem,calc(100vw-8rem))]">
                    <EdgeDetailPanel
                      edge={selectedEdge}
                      onClose={closeEdgeDetail}
                      className="w-full max-w-none"
                    />
                  </div>
                )}
                {selectedNode && (
                  <div className="w-[36rem] max-w-[min(36rem,calc(100vw-8rem))]">
                    <NodeDetailPanel
                      key={selectedNode.userId}
                      node={selectedNode}
                      edges={graphData.edges}
                      allNodes={graphData.nodes}
                      nodeMap={nodeMap}
                      onClose={closeNodeDetail}
                      className="max-h-[calc(100dvh-10rem)] w-full max-w-none"
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
