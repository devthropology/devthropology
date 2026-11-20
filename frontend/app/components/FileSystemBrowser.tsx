import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { API_URL, authenticatedFetch } from "../config";
import { getFilesystemStorageKey, TTL_HOURS } from "../utils/storageKeys";
import { TREE_INDENT_PX, TreeNode } from "./TreeNode";
import {
  collapseExpandedFolderPaths,
  collectAutoExpandFolderPaths,
  getAncestorPaths,
  getChildrenOf,
  getCompactFolderChain,
  getSortedChildrenOf,
} from "./fileSystemTreeState";
import type { FileSystemNode, FileSystemTreeResponse } from "../../../shared/models/fileSystemTree";

interface FileSystemBrowserProps {
  repositoryId: string;
  initialTreeData: FileSystemTreeResponse | null;
  token: string;
  selectedNodePath: string | null;
  onNodeSelect: (path: string | null) => void;
  onSelectedNodeChange: (node: FileSystemNode | null) => void;
  collapseAllVersion: number;
  scrollSelectionVersion: number;
  onInvalidSelectedPath: (path: string) => void;
}

type FolderLoadState = "idle" | "loading" | "loaded" | "error";

type SelectedPathStatus = "ready" | "missing-ancestor" | "missing-target" | "fetch-failed";

function getFolderLoadState(
  folderLoadStates: ReadonlyMap<string, FolderLoadState>,
  path: string | null,
) {
  return folderLoadStates.get(path ?? "ROOT") ?? "idle";
}

function getParentPath(path: string) {
  const lastSlashIndex = path.lastIndexOf("/");
  return lastSlashIndex === -1 ? null : path.slice(0, lastSlashIndex);
}

function getPathLevel(path: string) {
  return path.split("/").filter(Boolean).length;
}

export function FileSystemBrowser({
  repositoryId,
  initialTreeData,
  token,
  selectedNodePath,
  onNodeSelect,
  onSelectedNodeChange,
  collapseAllVersion,
  scrollSelectionVersion,
  onInvalidSelectedPath,
}: FileSystemBrowserProps) {
  const [allNodes, setAllNodes] = useState<FileSystemNode[]>(initialTreeData?.nodes || []);
  const [folderLoadStates, setFolderLoadStates] = useState<Map<string, FolderLoadState>>(
    () => new Map([["ROOT", "loaded"]]),
  );
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [autoExpandingFolders, setAutoExpandingFolders] = useState<Set<string>>(new Set());
  const [isResolvingSelectedPath, setIsResolvingSelectedPath] = useState(false);

  const allNodesRef = useRef(allNodes);
  const folderLoadStatesRef = useRef(folderLoadStates);
  const expandedFoldersRef = useRef(expandedFolders);
  const autoExpandingFoldersRef = useRef(autoExpandingFolders);
  const repositoryIdRef = useRef(repositoryId);
  const nodeElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const hasMountedCollapseRef = useRef(false);
  const lastQueuedScrollVersionRef = useRef(0);
  const pendingScrollPathRef = useRef<string | null>(null);
  const lastHydratedTreeRef = useRef<{ repositoryId: string; rootSignature: string } | null>(null);
  const inFlightChildLoadsRef = useRef<Map<string, Promise<FileSystemNode[]>>>(new Map());

  useEffect(() => {
    allNodesRef.current = allNodes;
  }, [allNodes]);

  useEffect(() => {
    folderLoadStatesRef.current = folderLoadStates;
  }, [folderLoadStates]);

  useEffect(() => {
    expandedFoldersRef.current = expandedFolders;
  }, [expandedFolders]);

  useEffect(() => {
    autoExpandingFoldersRef.current = autoExpandingFolders;
  }, [autoExpandingFolders]);

  useEffect(() => {
    repositoryIdRef.current = repositoryId;
  }, [repositoryId]);

  const loadedFolderPaths = useMemo(
    () =>
      new Set(
        Array.from(folderLoadStates.entries(), ([path, state]) =>
          state === "loaded" ? path : null,
        ).filter((path): path is string => path !== null),
      ),
    [folderLoadStates],
  );

  const rootSignature = (initialTreeData?.nodes || [])
    .map((node: FileSystemNode) => node.path)
    .join("\n");

  useEffect(() => {
    const lastHydratedTree = lastHydratedTreeRef.current;
    if (
      lastHydratedTree &&
      lastHydratedTree.repositoryId === repositoryId &&
      lastHydratedTree.rootSignature === rootSignature
    ) {
      return;
    }

    lastHydratedTreeRef.current = { repositoryId, rootSignature };

    const initialNodes = initialTreeData?.nodes || [];
    const initialFolderLoadStates = new Map<string, FolderLoadState>([["ROOT", "loaded"]]);

    setAllNodes(initialNodes);
    allNodesRef.current = initialNodes;

    setFolderLoadStates(initialFolderLoadStates);
    folderLoadStatesRef.current = initialFolderLoadStates;

    const nextAutoExpandingFolders = new Set<string>();
    autoExpandingFoldersRef.current = nextAutoExpandingFolders;
    setAutoExpandingFolders(nextAutoExpandingFolders);
    setIsResolvingSelectedPath(false);
    inFlightChildLoadsRef.current = new Map();

    const key = getFilesystemStorageKey(repositoryId);
    const stored = sessionStorage.getItem(key);

    if (!stored) {
      const nextExpandedFolders = new Set<string>();
      expandedFoldersRef.current = nextExpandedFolders;
      setExpandedFolders(nextExpandedFolders);
      return;
    }

    try {
      const { expandedPaths, timestamp } = JSON.parse(stored);
      const age = Date.now() - timestamp;

      if (age < TTL_HOURS * 60 * 60 * 1000) {
        const nextExpandedFolders = new Set<string>(expandedPaths);
        expandedFoldersRef.current = nextExpandedFolders;
        setExpandedFolders(nextExpandedFolders);
      } else {
        sessionStorage.removeItem(key);
        const nextExpandedFolders = new Set<string>();
        expandedFoldersRef.current = nextExpandedFolders;
        setExpandedFolders(nextExpandedFolders);
      }
    } catch (error) {
      console.warn("Failed to parse stored expanded folders:", error);
      sessionStorage.removeItem(key);
      const nextExpandedFolders = new Set<string>();
      expandedFoldersRef.current = nextExpandedFolders;
      setExpandedFolders(nextExpandedFolders);
    }
  }, [initialTreeData, repositoryId, rootSignature]);

  useEffect(() => {
    const key = getFilesystemStorageKey(repositoryId);

    if (expandedFolders.size === 0) {
      sessionStorage.removeItem(key);
      return;
    }

    const data = {
      expandedPaths: Array.from(expandedFolders),
      timestamp: Date.now(),
    };

    try {
      sessionStorage.setItem(key, JSON.stringify(data));
    } catch (error) {
      console.warn("Failed to save expanded folders to sessionStorage:", error);
    }
  }, [expandedFolders, repositoryId]);

  const fetchChildren = useCallback(
    async (parentPath: string | null, parentLevel?: number): Promise<FileSystemNode[]> => {
      const cacheKey = parentPath || "ROOT";

      const inFlightLoad = inFlightChildLoadsRef.current.get(cacheKey);
      if (inFlightLoad) {
        return inFlightLoad;
      }

      if (getFolderLoadState(folderLoadStatesRef.current, parentPath) === "loaded") {
        return getChildrenOf(allNodesRef.current, parentPath);
      }

      const loadPromise = (async () => {
        const nextFolderLoadStates = new Map(folderLoadStatesRef.current);
        nextFolderLoadStates.set(cacheKey, "loading");
        folderLoadStatesRef.current = nextFolderLoadStates;
        setFolderLoadStates(nextFolderLoadStates);

        try {
          const url = new URL(`${API_URL}/api/filesystem/${repositoryId}/tree`);

          if (parentPath && parentLevel !== undefined) {
            url.searchParams.set("parent", parentPath);
            url.searchParams.set("levels", String(parentLevel + 1));
          } else {
            url.searchParams.set("levels", "1");
          }

          const response = await authenticatedFetch(url.toString(), token);
          if (!response.ok) {
            throw new Error("Failed to fetch filesystem children");
          }

          const data: FileSystemTreeResponse = await response.json();

          const existingPaths = new Set(allNodesRef.current.map((node) => node.path));
          const newNodes = data.nodes.filter(
            (node: FileSystemNode) => !existingPaths.has(node.path),
          );
          const nextNodes = [...allNodesRef.current, ...newNodes];

          // Keep the ref in sync immediately so follow-up selection checks do not
          // observe a folder as loaded before its children are available.
          allNodesRef.current = nextNodes;
          setAllNodes(nextNodes);

          // Only mark a folder as loaded once its children are available locally.
          const nextFolderLoadStates = new Map(folderLoadStatesRef.current);
          nextFolderLoadStates.set(cacheKey, "loaded");
          folderLoadStatesRef.current = nextFolderLoadStates;
          setFolderLoadStates(nextFolderLoadStates);

          return data.nodes;
        } catch (error) {
          console.error(`Error fetching children for ${parentPath || "root"}:`, error);

          const nextFolderLoadStates = new Map(folderLoadStatesRef.current);
          nextFolderLoadStates.set(cacheKey, "error");
          folderLoadStatesRef.current = nextFolderLoadStates;
          setFolderLoadStates(nextFolderLoadStates);

          if (parentPath) {
            setExpandedFolders((prev) => {
              if (!prev.has(parentPath)) {
                return prev;
              }

              const nextExpandedFolders = new Set(prev);
              nextExpandedFolders.delete(parentPath);
              expandedFoldersRef.current = nextExpandedFolders;
              return nextExpandedFolders;
            });
          }

          return [];
        } finally {
          inFlightChildLoadsRef.current.delete(cacheKey);
        }
      })();

      inFlightChildLoadsRef.current.set(cacheKey, loadPromise);
      return loadPromise;
    },
    [getChildrenOf, repositoryId, token],
  );

  const expandFolderChain = useCallback(
    async (startNode: FileSystemNode) => {
      return collectAutoExpandFolderPaths(startNode, (node) =>
        fetchChildren(node.path, node.level),
      );
    },
    [fetchChildren],
  );

  const handleFolderToggle = useCallback(
    (folderPath: string, isExpanded: boolean, collapsePath?: string) => {
      const collapseRoot = collapsePath ?? folderPath;

      if (isExpanded) {
        const folder = allNodesRef.current.find((node) => node.path === folderPath);
        if (!folder || folder.type !== "folder") {
          return;
        }

        setAutoExpandingFolders((prev) => {
          const nextAutoExpandingFolders = new Set(prev);
          nextAutoExpandingFolders.add(collapseRoot);
          autoExpandingFoldersRef.current = nextAutoExpandingFolders;
          return nextAutoExpandingFolders;
        });

        void expandFolderChain(folder).then((pathsToExpand) => {
          if (!autoExpandingFoldersRef.current.has(collapseRoot)) {
            return;
          }

          setExpandedFolders((prev) => {
            const nextExpandedFolders = new Set(prev);
            pathsToExpand.forEach((path) => nextExpandedFolders.add(path));
            expandedFoldersRef.current = nextExpandedFolders;
            return nextExpandedFolders;
          });

          setAutoExpandingFolders((prev) => {
            const nextAutoExpandingFolders = new Set(prev);
            nextAutoExpandingFolders.delete(collapseRoot);
            autoExpandingFoldersRef.current = nextAutoExpandingFolders;
            return nextAutoExpandingFolders;
          });
        });

        return;
      }

      setAutoExpandingFolders((prev) => {
        if (!prev.has(collapseRoot)) {
          return prev;
        }

        const nextAutoExpandingFolders = new Set(prev);
        nextAutoExpandingFolders.delete(collapseRoot);
        autoExpandingFoldersRef.current = nextAutoExpandingFolders;
        return nextAutoExpandingFolders;
      });

      setExpandedFolders((prev) => {
        const nextExpandedFolders = collapseExpandedFolderPaths(prev, collapseRoot);
        expandedFoldersRef.current = nextExpandedFolders;
        return nextExpandedFolders;
      });
    },
    [expandFolderChain],
  );

  useEffect(() => {
    if (!hasMountedCollapseRef.current) {
      hasMountedCollapseRef.current = true;
      return;
    }

    sessionStorage.removeItem(getFilesystemStorageKey(repositoryIdRef.current));
    const nextExpandedFolders = new Set<string>();
    expandedFoldersRef.current = nextExpandedFolders;
    setExpandedFolders(nextExpandedFolders);

    const nextAutoExpandingFolders = new Set<string>();
    autoExpandingFoldersRef.current = nextAutoExpandingFolders;
    setAutoExpandingFolders(nextAutoExpandingFolders);
  }, [collapseAllVersion]);

  useEffect(() => {
    if (expandedFolders.size === 0 || allNodes.length === 0) {
      return;
    }

    Array.from(expandedFolders).forEach((folderPath) => {
      if (getFolderLoadState(folderLoadStatesRef.current, folderPath) === "loaded") {
        return;
      }

      const folder = allNodesRef.current.find((node) => node.path === folderPath);
      if (folder) {
        void fetchChildren(folderPath, folder.level);
      }
    });
  }, [allNodes.length, expandedFolders, fetchChildren]);

  useEffect(() => {
    if (!selectedNodePath) {
      setIsResolvingSelectedPath(false);
      return;
    }

    setIsResolvingSelectedPath(false);

    let isCancelled = false;
    const ancestorPaths = getAncestorPaths(selectedNodePath);

    if (ancestorPaths.length > 0) {
      setExpandedFolders((prev) => {
        const nextExpandedFolders = new Set(prev);
        let changed = false;

        ancestorPaths.forEach((ancestorPath) => {
          if (!nextExpandedFolders.has(ancestorPath)) {
            nextExpandedFolders.add(ancestorPath);
            changed = true;
          }
        });

        if (changed) {
          expandedFoldersRef.current = nextExpandedFolders;
        }

        return changed ? nextExpandedFolders : prev;
      });
    }

    const ensurePathLoaded = async (): Promise<SelectedPathStatus> => {
      const knownNodes = new Map(allNodesRef.current.map((node) => [node.path, node]));
      const missingAncestorPaths = ancestorPaths.filter(
        (ancestorPath) =>
          getFolderLoadState(folderLoadStatesRef.current, ancestorPath) !== "loaded",
      );

      if (!knownNodes.has(selectedNodePath) && missingAncestorPaths.length > 0) {
        setIsResolvingSelectedPath(true);
      }

      if (missingAncestorPaths.length > 0) {
        await Promise.all(
          missingAncestorPaths.map((ancestorPath) =>
            fetchChildren(ancestorPath, getPathLevel(ancestorPath)),
          ),
        );
      }

      if (isCancelled) {
        return "fetch-failed";
      }

      const refreshedKnownNodes = new Map(allNodesRef.current.map((node) => [node.path, node]));

      for (const ancestorPath of ancestorPaths) {
        if (getFolderLoadState(folderLoadStatesRef.current, ancestorPath) === "error") {
          return "fetch-failed";
        }

        const ancestorNode = refreshedKnownNodes.get(ancestorPath);
        if (!ancestorNode || ancestorNode.type !== "folder") {
          return "missing-ancestor";
        }
      }

      if (refreshedKnownNodes.has(selectedNodePath)) {
        return "ready";
      }

      const parentPath = getParentPath(selectedNodePath);
      if (getFolderLoadState(folderLoadStatesRef.current, parentPath) === "error") {
        return "fetch-failed";
      }

      return "missing-target";
    };

    void ensurePathLoaded().then((status) => {
      if (isCancelled) {
        return;
      }

      setIsResolvingSelectedPath(false);

      if (status === "missing-ancestor" || status === "missing-target") {
        onInvalidSelectedPath(selectedNodePath);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [fetchChildren, getAncestorPaths, onInvalidSelectedPath, selectedNodePath]);

  useEffect(() => {
    if (!selectedNodePath) {
      onSelectedNodeChange(null);
      return;
    }

    const selectedNode = allNodes.find((node) => node.path === selectedNodePath) ?? null;

    if (selectedNode) {
      onSelectedNodeChange(selectedNode);
    }
  }, [allNodes, onSelectedNodeChange, selectedNodePath]);

  useEffect(() => {
    if (scrollSelectionVersion === lastQueuedScrollVersionRef.current) {
      return;
    }

    lastQueuedScrollVersionRef.current = scrollSelectionVersion;
    pendingScrollPathRef.current = selectedNodePath;
  }, [scrollSelectionVersion, selectedNodePath]);

  useEffect(() => {
    const pendingScrollPath = pendingScrollPathRef.current;
    if (!pendingScrollPath) {
      return;
    }

    const selectedElement = nodeElementsRef.current.get(pendingScrollPath);
    if (!selectedElement) {
      return;
    }

    pendingScrollPathRef.current = null;

    window.requestAnimationFrame(() => {
      selectedElement.scrollIntoView({ block: "center" });
    });
  }, [allNodes, scrollSelectionVersion]);

  const registerNodeElement = useCallback((path: string, element: HTMLDivElement | null) => {
    if (element) {
      nodeElementsRef.current.set(path, element);
      return;
    }

    nodeElementsRef.current.delete(path);
  }, []);

  const renderTreeLevel = useCallback(
    (parentPath: string | null, depth: number = 0) => {
      const sortedChildren = getSortedChildrenOf(allNodes, parentPath);

      return sortedChildren.map((node) => {
        const compactChain = getCompactFolderChain({
          startNode: node,
          allNodes,
          levelsLoaded: loadedFolderPaths,
          expandedFolders,
        });

        const compactNode = compactChain[compactChain.length - 1];
        const isExpanded = expandedFolders.has(compactNode.path);
        const isAutoExpanding = autoExpandingFolders.has(node.path);
        const hasChildren =
          compactNode.type === "folder" &&
          (getChildrenOf(allNodes, compactNode.path).length > 0 ||
            !loadedFolderPaths.has(compactNode.path));
        const displayName = compactChain.map((chainNode) => chainNode.name).join("/");
        const isSelected =
          selectedNodePath !== null &&
          compactChain.some((chainNode) => chainNode.path === selectedNodePath);

        return (
          <div key={node.path}>
            <TreeNode
              node={compactNode}
              displayName={displayName}
              isExpanded={isExpanded}
              hasChildren={hasChildren}
              depth={depth}
              onToggle={handleFolderToggle}
              togglePath={compactNode.path}
              collapsePath={node.path}
              isLoading={isAutoExpanding}
              isSelected={isSelected}
              onSelect={onNodeSelect}
              nodeRef={(element) => registerNodeElement(compactNode.path, element)}
            />
            {isExpanded && compactNode.type === "folder" && (
              <div>
                {renderTreeLevel(compactNode.path, depth + 1)}
                {getFolderLoadState(folderLoadStates, compactNode.path) === "loading" && (
                  <div
                    className="flex items-center py-2 text-gray-400"
                    style={{ paddingLeft: `${(depth + 1) * TREE_INDENT_PX}px` }}
                  >
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading...
                  </div>
                )}
              </div>
            )}
          </div>
        );
      });
    },
    [
      allNodes,
      autoExpandingFolders,
      expandedFolders,
      folderLoadStates,
      getSortedChildrenOf,
      getChildrenOf,
      handleFolderToggle,
      loadedFolderPaths,
      onNodeSelect,
      registerNodeElement,
      selectedNodePath,
    ],
  );

  return (
    <div className="space-y-1">
      {isResolvingSelectedPath && (
        <div className="sticky top-0 z-10 inline-flex items-center gap-2 rounded-md border border-white/10 bg-slate-900/90 px-2 py-1 text-xs text-gray-300 shadow-sm">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Resolving selected path...
        </div>
      )}
      {renderTreeLevel(null)}
    </div>
  );
}
