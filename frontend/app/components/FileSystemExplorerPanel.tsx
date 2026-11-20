import { Loader2 } from "lucide-react";
import { FileSystemBrowser } from "./FileSystemBrowser";
import { EmptyState } from "./ui/EmptyState";
import type { FileSystemNode, FileSystemTreeResponse } from "../../../shared/models/fileSystemTree";

interface FileSystemExplorerPanelProps {
  repositoryId: string;
  treeData: FileSystemTreeResponse | null;
  token: string;
  selectedNodePath: string | null;
  onNodeSelect: (path: string | null) => void;
  onSelectedNodeChange: (node: FileSystemNode | null) => void;
  collapseAllVersion: number;
  scrollSelectionVersion: number;
  onInvalidSelectedPath: (path: string) => void;
  isLoading: boolean;
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center h-32">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

export function FileSystemExplorerPanel({
  repositoryId,
  treeData,
  token,
  selectedNodePath,
  onNodeSelect,
  onSelectedNodeChange,
  collapseAllVersion,
  scrollSelectionVersion,
  onInvalidSelectedPath,
  isLoading,
}: FileSystemExplorerPanelProps) {
  const hasData = treeData && treeData.nodes && treeData.nodes.length > 0;

  return (
    <div className="flex h-full flex-col rounded-lg border border-gray-600/70 bg-slate-900/40 p-3 sm:p-4">
      <div className="relative flex-1 overflow-y-auto pr-1 sm:pr-2">
        {hasData ? (
          <FileSystemBrowser
            repositoryId={repositoryId}
            initialTreeData={treeData}
            token={token}
            selectedNodePath={selectedNodePath}
            onNodeSelect={onNodeSelect}
            onSelectedNodeChange={onSelectedNodeChange}
            collapseAllVersion={collapseAllVersion}
            scrollSelectionVersion={scrollSelectionVersion}
            onInvalidSelectedPath={onInvalidSelectedPath}
          />
        ) : isLoading ? (
          <LoadingState />
        ) : (
          <EmptyState message="No filesystem data available for this repository." />
        )}
        {isLoading && hasData && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-start bg-gradient-to-t from-slate-900/90 to-transparent px-2 pb-2 pt-10">
            <div className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-slate-900/90 px-2 py-1 text-xs text-gray-300 shadow-lg">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Updating...
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
