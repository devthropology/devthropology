import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { FileSystemExplorerPanel } from "./FileSystemExplorerPanel";
import { FileSystemDetailPanel } from "./FileSystemDetailPanel";
import type { FileSystemNode, FileSystemTreeResponse } from "../../../shared/models/fileSystemTree";
import type { RepositoryDetails } from "../routes/types";

const STORAGE_KEY = "fs-explorer-split";
const DEFAULT_SPLIT = 55; // percent
const MIN_SPLIT = 20;
const MAX_SPLIT = 80;

function clampSplitPct(value: number) {
  return Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, value));
}

interface FileSystemLayoutProps {
  repositoryId: string;
  repository: RepositoryDetails | null;
  treeData: FileSystemTreeResponse | null;
  token: string;
  selectedNodePath: string | null;
  onNodeSelect: (path: string | null) => void;
  onRelatedPathNavigate: (path: string) => void;
  collapseAllVersion: number;
  scrollSelectionVersion: number;
  onInvalidSelectedPath: (path: string) => void;
  isLoading: boolean;
}

export function FileSystemLayout({
  repositoryId,
  repository,
  treeData,
  token,
  selectedNodePath,
  onNodeSelect,
  onRelatedPathNavigate,
  collapseAllVersion,
  scrollSelectionVersion,
  onInvalidSelectedPath,
  isLoading,
}: FileSystemLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const topPanelRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const [selectedNode, setSelectedNode] = useState<FileSystemNode | null>(null);
  const hasSelection = selectedNode !== null;

  const [splitPct, setSplitPct] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_SPLIT;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const val = parseFloat(stored);
      if (!isNaN(val) && val >= MIN_SPLIT && val <= MAX_SPLIT) return val;
    }
    return DEFAULT_SPLIT;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(splitPct));
  }, [splitPct]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    isDragging.current = true;
    activePointerIdRef.current = event.pointerId;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    // Disable transition during drag
    if (topPanelRef.current) {
      topPanelRef.current.style.transition = "none";
    }
  }, []);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (!isDragging.current || !containerRef.current || !topPanelRef.current) return;
      if (activePointerIdRef.current !== null && event.pointerId !== activePointerIdRef.current) {
        return;
      }

      const rect = containerRef.current.getBoundingClientRect();
      const y = event.clientY - rect.top;
      const pct = clampSplitPct((y / rect.height) * 100);
      // Write directly to DOM — no React re-render during drag
      topPanelRef.current.style.height = `${pct}%`;
    };

    const onPointerEnd = (event: PointerEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      if (activePointerIdRef.current !== null && event.pointerId !== activePointerIdRef.current) {
        return;
      }

      isDragging.current = false;
      activePointerIdRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // Re-enable transition
      if (topPanelRef.current) {
        topPanelRef.current.style.transition = "";
      }
      // Commit final value to React state (persists to localStorage)
      const rect = containerRef.current.getBoundingClientRect();
      const y = event.clientY - rect.top;
      const pct = clampSplitPct((y / rect.height) * 100);
      setSplitPct(pct);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
    };
  }, []);

  return (
    <div ref={containerRef} className="flex h-full min-h-0 flex-col">
      {/* Tree View — full height when nothing selected, split height otherwise */}
      <div
        ref={topPanelRef}
        className="min-h-0 overflow-hidden transition-[height] duration-200"
        style={{ height: hasSelection ? `${splitPct}%` : "100%" }}
      >
        <FileSystemExplorerPanel
          repositoryId={repositoryId}
          treeData={treeData}
          token={token}
          selectedNodePath={selectedNodePath}
          onNodeSelect={onNodeSelect}
          onSelectedNodeChange={setSelectedNode}
          collapseAllVersion={collapseAllVersion}
          scrollSelectionVersion={scrollSelectionVersion}
          onInvalidSelectedPath={onInvalidSelectedPath}
          isLoading={isLoading}
        />
      </div>

      {/* Drag Handle + Detail Panel — only rendered when a node is selected */}
      {hasSelection && (
        <>
          <div
            className="flex-shrink-0 flex items-center justify-center cursor-row-resize touch-none group py-2"
            onPointerDown={onPointerDown}
          >
            <div className="w-12 h-0.5 rounded-full bg-gray-600 group-hover:bg-gray-400 transition-colors" />
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            <FileSystemDetailPanel
              selectedNode={selectedNode}
              repository={repository}
              repositoryId={repositoryId}
              onNavigateToPath={onRelatedPathNavigate}
            />
          </div>
        </>
      )}
    </div>
  );
}
