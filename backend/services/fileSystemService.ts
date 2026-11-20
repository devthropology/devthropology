import { IRepository } from "../repository/repository.ts";
import { FileSystemTreeBuilder } from "./fileSystemTreeBuilder.ts";
import {
  FileSystemNode,
  FileSystemPRsResponse,
  FileSystemTreeResponse,
} from "../../shared/models/index.ts";
import { ComputedFileSystemNode } from "../models/dbTypes.ts";
import { Stopwatch } from "../util/stopwatch.ts";

export class FileSystemService {
  private repository: IRepository;
  private fileSystemTreeBuilder: FileSystemTreeBuilder;
  private logFn: (...args: unknown[]) => void;
  private warnFn: (...args: unknown[]) => void;
  private errorFn: (...args: unknown[]) => void;

  constructor(
    repository: IRepository,
    loggers?: {
      log?: (...args: unknown[]) => void;
      warn?: (...args: unknown[]) => void;
      error?: (...args: unknown[]) => void;
    },
  ) {
    this.repository = repository;
    this.fileSystemTreeBuilder = new FileSystemTreeBuilder();
    this.logFn = loggers?.log ?? ((...args: unknown[]) => console.log(...args));
    this.warnFn =
      loggers?.warn ?? ((...args: unknown[]) => console.warn(...args));
    this.errorFn =
      loggers?.error ?? ((...args: unknown[]) => console.error(...args));
  }

  async getFileSystemTree(
    repositoryId: number,
    parentPath: string,
    levels: number[],
  ): Promise<FileSystemTreeResponse> {
    this.logFn(
      `Filtering tree for repository ${repositoryId}, parent: "${parentPath}", levels: ${levels}`,
    );

    try {
      // First try to get data from database
      const computedNodes = await this.repository.getFileSystemNodes(
        repositoryId,
        parentPath,
        levels,
      );

      if (computedNodes.length > 0) {
        this.logFn(
          `Found ${computedNodes.length} nodes in database for repository ${repositoryId}`,
        );
        const nodes = this.transformFromComputedNodes(computedNodes);

        // Sort nodes (folders first, then by total changes descending)
        const sortedNodes = nodes.sort((a, b) => {
          if (a.type !== b.type) {
            return a.type === "folder" ? -1 : 1;
          }

          // 2. Secondary sort: total_changes (descending)
          if (a.total_changes !== b.total_changes) {
            return b.total_changes - a.total_changes;
          }

          // 3. Tie-breaker sort: path (alphabetical / ascending)
          return a.path.localeCompare(b.path);
        });

        return {
          parent_path: parentPath,
          requested_levels: levels,
          nodes: sortedNodes,
        };
      } else {
        // No data in database - return empty result (no fallback computation)
        this.logFn(
          `No data in database for repository ${repositoryId} - returning empty result`,
        );
        return {
          parent_path: parentPath,
          requested_levels: levels,
          nodes: [],
        };
      }
    } catch (error) {
      this.warnFn(
        `Database query failed for repository ${repositoryId}:`,
        error,
      );
      // Return empty result on database error
      return {
        parent_path: parentPath,
        requested_levels: levels,
        nodes: [],
      };
    }
  }

  /**
   * Gets PRs that touch a specific filesystem path.
   * Uses the precomputed total_prs count from computed_filesystem for the total,
   * and queries the normalized tables for the actual PR list.
   *
   * Results are ordered by issue.created_at DESC rather than pull_request.merged_at DESC.
   * This is intentional: the pull_request table has no index on merged_at or target_branch,
   * so ordering by merged_at forces a parallel seq scan across ~134K rows. By ordering on
   * created_at we leverage the existing idx_issue_repository_id_created_at index, which
   * lets Postgres walk the index backwards and exit early once LIMIT is satisfied (~1-4ms
   * for high-activity paths). The tradeoff is marginal — created_at and merged_at are
   * highly correlated for merged PRs, so the display order is effectively the same.
   *
   * If exact merged_at ordering becomes important, add a partial index:
   *   CREATE INDEX ON pull_request (merged_at DESC)
   *     WHERE merged_at IS NOT NULL AND lower(target_branch) IN ('main', 'master');
   */
  async getFileSystemPRs(
    repositoryId: number,
    path: string,
    type: "file" | "folder",
    limit: number,
    offset: number,
  ): Promise<FileSystemPRsResponse> {
    this.logFn(
      `Fetching PRs for repository ${repositoryId}, path: "${path}", type: ${type}, limit: ${limit}, offset: ${offset}`,
    );

    // Get the precomputed total from the filesystem node via direct path lookup.
    // Previously this fetched all sibling nodes via getFileSystemNodes, which for
    // top-level folders loaded the entire tree (~110K rows, ~800ms). The unique
    // index on (repository_id, path) makes this a ~2ms lookup instead.
    const node = await this.repository.getFileSystemNodeByPath(
      repositoryId,
      path,
    );
    const total = node ? (node.node_data as FileSystemNode).total_prs : 0;

    const prs = await this.repository.getFileSystemPRs(
      repositoryId,
      path,
      type,
      limit,
      offset,
    );

    return {
      path,
      type,
      prs,
      total,
      limit,
      offset,
    };
  }

  /**
   * Computes filesystem tree and persists it to database for faster future retrieval
   */
  async computeAndStore(repositoryId: number): Promise<void> {
    const stopWatch = new Stopwatch();

    try {
      // Repository 1 has ~1.5M rows, so scope to identity-fingerprinting-api for performance
      // Other repositories are smaller and can process all files
      const pathFilter = "";
      stopWatch.start("Read directory stats");
      // TODO DAN: rename this and move to separate repository
      const fsActivity = await this.repository.getDirectoryStats(
        repositoryId,
        pathFilter,
      );

      if (fsActivity.length === 0) {
        this.logFn(`No activities found for repository ${repositoryId}`);
        return;
      }

      // Build user last-seen map and pass to pure builder
      stopWatch.start("Read user activity");
      const ua = await this.repository.getUserActivity(repositoryId);
      if (!ua || ua.length === 0) {
        throw new Error(
          `User activity data is missing for repository ${repositoryId}; cannot build filesystem tree`,
        );
      }
      const userLastSeenByUserId = new Map<number, string>();
      for (const row of ua) {
        const iso = new Date(row.last_seen_timestamp).toISOString();
        userLastSeenByUserId.set(row.user_id, iso);
      }

      stopWatch.start("Build filesystem tree");
      const treeData = this.fileSystemTreeBuilder.buildFileSystemTree(
        fsActivity,
        userLastSeenByUserId,
      );

      if (treeData.nodes.size === 0) {
        this.logFn(
          `No filesystem data to persist for repository ${repositoryId}`,
        );
        return;
      }

      const nodes = Array.from(treeData.nodes.values());
      const computedNodes = this.transformToComputedNodes(repositoryId, nodes);

      stopWatch.start("Persist filesystem data");
      await this.repository.persistFileSystem(repositoryId, computedNodes);

      stopWatch.print(
        `Filesystem computation for repository ${repositoryId} (${fsActivity.length.toLocaleString()} activities)`,
        this.logFn,
      );
    } catch (error) {
      this.errorFn(
        `Failed to compute and store filesystem data for repository ${repositoryId}:`,
        error,
      );
      throw error;
    }
  }

  private transformToComputedNodes(
    repositoryId: number,
    nodes: FileSystemNode[],
  ): ComputedFileSystemNode[] {
    return nodes.map((node) => ({
      repository_id: repositoryId,
      path: node.path,
      parent_path: node.parent_path,
      level: node.level,
      node_data: node,
    }));
  }

  private transformFromComputedNodes(
    computedNodes: ComputedFileSystemNode[],
  ): FileSystemNode[] {
    return computedNodes.map((computed) => {
      return computed.node_data as FileSystemNode;
    });
  }
}
