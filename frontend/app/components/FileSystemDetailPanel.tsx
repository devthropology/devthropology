import { FileSystemDetail } from "./FileSystemDetail";
import type { FileSystemNode } from "../../../shared/models/fileSystemTree";
import type { RepositoryDetails } from "../routes/types";

interface FileSystemDetailPanelProps {
  selectedNode: FileSystemNode | null;
  repository: RepositoryDetails | null;
  repositoryId: string;
  onNavigateToPath: (path: string) => void;
}

export function FileSystemDetailPanel({
  selectedNode,
  repository,
  repositoryId,
  onNavigateToPath,
}: FileSystemDetailPanelProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-gray-600/70 bg-slate-900/30 p-3 sm:p-4">
      <FileSystemDetail
        selectedNode={selectedNode}
        repository={repository}
        repositoryId={repositoryId}
        onNavigateToPath={onNavigateToPath}
      />
    </div>
  );
}
