import { IRepository } from "../../repository/repository.ts";
import { FileSystemNode } from "../../../shared/models/index.ts";

export type AgentRelatedFile = {
  path: string;
  shared_prs: number;
  cochange_pct: number;
};

export type AgentInputFileRelatedFiles = {
  path: string;
  related_files: AgentRelatedFile[];
};

export type AgentRelatedFilesResponse = {
  repository: { org: string; name: string };
  input_paths: string[];
  missing_paths: string[];
  files: AgentInputFileRelatedFiles[];
};

export class AgentContextService {
  constructor(private repository: IRepository) {}

  async getRelatedFiles(
    repositoryId: number,
    repositoryMetadata: { org: string; name: string },
    paths: string[],
    limit: number,
  ): Promise<AgentRelatedFilesResponse> {
    const inputPaths = normalizePaths(paths);
    const inputSet = new Set(inputPaths);
    const missingPaths: string[] = [];

    const nodes = await Promise.all(
      inputPaths.map((path) =>
        this.repository.getFileSystemNodeByPath(repositoryId, path),
      ),
    );

    const files = nodes.map((computedNode, index) => {
      const inputPath = inputPaths[index];
      if (!computedNode) {
        missingPaths.push(inputPath);
        return { path: inputPath, related_files: [] };
      }

      const node = computedNode.node_data as FileSystemNode;
      const relatedFiles = (node.related_entities ?? [])
        .filter(
          (entity) => entity.type === "file" && !inputSet.has(entity.path),
        )
        .sort((a, b) => {
          if (a.cochange_pct !== b.cochange_pct) {
            return b.cochange_pct - a.cochange_pct;
          }
          if (a.shared_prs !== b.shared_prs) {
            return b.shared_prs - a.shared_prs;
          }
          return a.path.localeCompare(b.path);
        })
        .slice(0, limit)
        .map((entity) => ({
          path: entity.path,
          shared_prs: entity.shared_prs,
          cochange_pct: entity.cochange_pct,
        }));

      return { path: inputPath, related_files: relatedFiles };
    });

    return {
      repository: repositoryMetadata,
      input_paths: inputPaths,
      missing_paths: missingPaths,
      files,
    };
  }
}

function normalizePaths(paths: string[]): string[] {
  return Array.from(
    new Set(
      paths
        .map((path) => path.trim())
        .filter(Boolean)
        .map((path) => path.replace(/^\.\//, "").replace(/^\/+/, "")),
    ),
  );
}
