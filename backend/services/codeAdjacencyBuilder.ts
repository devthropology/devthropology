import { FileSystemActivity } from "../models/dbTypes.ts";
import {
  RelatedEntity,
  RelatedEntitySharedPR,
} from "../../shared/models/index.ts";

export interface AdjacencyPathNode {
  path: string;
  type: "file" | "folder";
  activities: FileSystemActivity[];
}

export interface CodeAdjacencyOptions {
  minSharedPrs: number;
  minCochangePct: number;
  maxRelatedEntities: number;
  maxFilesPerPr: number;
  maxRecentSharedPrs: number;
}

export const DEFAULT_CODE_ADJACENCY_OPTIONS: CodeAdjacencyOptions = {
  minSharedPrs: 2,
  minCochangePct: 25,
  maxRelatedEntities: 8,
  maxFilesPerPr: 25,
  maxRecentSharedPrs: 5,
};

interface PairAdjacencyStats {
  sharedPrs: number;
  recentSharedPrs: RelatedEntitySharedPR[];
}

export class CodeAdjacencyBuilder {
  private readonly options: CodeAdjacencyOptions;

  constructor(options: Partial<CodeAdjacencyOptions> = {}) {
    this.options = {
      ...DEFAULT_CODE_ADJACENCY_OPTIONS,
      ...options,
    };
  }

  buildFileAdjacency(
    pathNodes: Map<string, AdjacencyPathNode>,
  ): Map<string, RelatedEntity[]> {
    const prToFiles = new Map<number, Set<string>>();
    const filePrsByPath = new Map<string, Set<number>>();
    const prDetailsById = new Map<number, RelatedEntitySharedPR>();

    pathNodes.forEach((node) => {
      if (node.type !== "file" || node.activities.length === 0) {
        return;
      }

      const filePrs = filePrsByPath.get(node.path) ?? new Set<number>();

      node.activities.forEach((activity) => {
        filePrs.add(activity.gh_issue_id);
        prDetailsById.set(activity.gh_issue_id, {
          gh_issue_id: activity.gh_issue_id,
          title: activity.title,
          merged_at: activity.merged_at ?? activity.inserted_at,
        });

        const filesInPr =
          prToFiles.get(activity.gh_issue_id) ?? new Set<string>();
        filesInPr.add(node.path);
        prToFiles.set(activity.gh_issue_id, filesInPr);
      });

      filePrsByPath.set(node.path, filePrs);
    });

    const sharedCountsByPath = new Map<
      string,
      Map<string, PairAdjacencyStats>
    >();

    prToFiles.forEach((files, prId) => {
      if (files.size < 2 || files.size > this.options.maxFilesPerPr) {
        return;
      }

      const prDetails = prDetailsById.get(prId);
      if (!prDetails) {
        return;
      }

      const paths = Array.from(files).sort();
      for (let i = 0; i < paths.length; i++) {
        for (let j = i + 1; j < paths.length; j++) {
          this.incrementPair(sharedCountsByPath, paths[i], paths[j], prDetails);
          this.incrementPair(sharedCountsByPath, paths[j], paths[i], prDetails);
        }
      }
    });

    const adjacencyByPath = new Map<string, RelatedEntity[]>();

    sharedCountsByPath.forEach((neighbors, sourcePath) => {
      const totalPrs = filePrsByPath.get(sourcePath)?.size ?? 0;
      if (totalPrs === 0) {
        return;
      }

      const relatedEntities = Array.from(neighbors.entries())
        .map(([path, stats]) => ({
          path,
          type: "file" as const,
          shared_prs: stats.sharedPrs,
          cochange_pct: Math.round((stats.sharedPrs / totalPrs) * 1000) / 10,
          recent_shared_prs: stats.recentSharedPrs,
        }))
        .filter((entity) => {
          return (
            entity.shared_prs >= this.options.minSharedPrs &&
            entity.cochange_pct >= this.options.minCochangePct
          );
        })
        .sort((a, b) => {
          if (a.shared_prs !== b.shared_prs) {
            return b.shared_prs - a.shared_prs;
          }
          if (a.cochange_pct !== b.cochange_pct) {
            return b.cochange_pct - a.cochange_pct;
          }
          return a.path.localeCompare(b.path);
        })
        .slice(0, this.options.maxRelatedEntities);

      if (relatedEntities.length > 0) {
        adjacencyByPath.set(sourcePath, relatedEntities);
      }
    });

    return adjacencyByPath;
  }

  private incrementPair(
    sharedCountsByPath: Map<string, Map<string, PairAdjacencyStats>>,
    sourcePath: string,
    relatedPath: string,
    prDetails: RelatedEntitySharedPR,
  ) {
    const neighbors =
      sharedCountsByPath.get(sourcePath) ??
      new Map<string, PairAdjacencyStats>();
    const existingStats = neighbors.get(relatedPath);
    const nextStats = existingStats
      ? {
          sharedPrs: existingStats.sharedPrs + 1,
          recentSharedPrs: this.mergeRecentSharedPrs(
            existingStats.recentSharedPrs,
            prDetails,
          ),
        }
      : {
          sharedPrs: 1,
          recentSharedPrs: [prDetails],
        };

    neighbors.set(relatedPath, nextStats);
    sharedCountsByPath.set(sourcePath, neighbors);
  }

  private mergeRecentSharedPrs(
    existing: RelatedEntitySharedPR[],
    next: RelatedEntitySharedPR,
  ): RelatedEntitySharedPR[] {
    return [...existing, next]
      .sort((a, b) => b.merged_at.localeCompare(a.merged_at))
      .slice(0, this.options.maxRecentSharedPrs);
  }
}
