import { FileSystemActivity } from "../models/dbTypes.ts";
import {
  FileHistoryEvent,
  FileSystemContributor,
  FileSystemNode,
  NodeHealth,
} from "../../shared/models/index.ts";
import {
  CodeAdjacencyBuilder,
  CodeAdjacencyOptions,
} from "./codeAdjacencyBuilder.ts";

// Internal working model during tree building
export interface PathNode {
  path: string; // "backend/services/auth.ts"
  name: string; // "auth.ts"
  level: number; // 3
  type: "file" | "folder";
  parent_path: string | null;
  activities: FileSystemActivity[]; // only populated for files
  children: Set<string>; // paths of direct children
}

// New tree API output
export interface FileSystemTreeData {
  nodes: Map<string, FileSystemNode>; // path -> FileSystemNode
  rootPaths: string[]; // top-level paths for easy iteration
}

/**
 * Handles filesystem activity analysis and tree building.
 * Provides both legacy directory stats and new hierarchical tree functionality.
 */
export class FileSystemTreeBuilder {
  private userLastSeenByUserId?: Map<number, string>;
  // Internal: track recent PR counts by path for unified health recompute
  private recentPRCountByPath: Map<string, number> = new Map();
  private readonly nowProvider: () => Date;
  private readonly codeAdjacencyBuilder: CodeAdjacencyBuilder;
  private currentNow: Date;

  constructor(
    nowProvider: () => Date = () => new Date(),
    codeAdjacencyOptions: Partial<CodeAdjacencyOptions> = {},
  ) {
    this.nowProvider = nowProvider;
    this.codeAdjacencyBuilder = new CodeAdjacencyBuilder(codeAdjacencyOptions);
    this.currentNow = this.nowProvider();
  }

  /** Builds hierarchical filesystem tree */
  buildFileSystemTree(
    activities: FileSystemActivity[],
    userLastSeenByUserId: Map<number, string>,
  ): FileSystemTreeData {
    this.currentNow = this.nowProvider();
    console.log(`Building filesystem tree for ${activities.length} activities`);

    // Store for use in calculateFileStats
    this.userLastSeenByUserId = userLastSeenByUserId;

    const renameChains = this.buildRenameChains(activities);
    const pathNodes = this.buildPathNodes(activities, renameChains);

    const aggregatedNodes = this.aggregateStatsBottomUp(pathNodes);
    this.attachFileHistory(pathNodes, aggregatedNodes);
    this.attachRelatedEntities(pathNodes, aggregatedNodes);

    // Enrich contributors with last_seen_anywhere from user_activity
    this.populateContributorLastSeenAnyWhere(
      aggregatedNodes,
      activities,
      userLastSeenByUserId,
    );

    // After enriching contributors with last_seen_anywhere, recompute folder health
    this.recomputeFolderHealth(aggregatedNodes);

    // Find root paths (level 1 nodes)
    const rootPaths = Array.from(aggregatedNodes.values())
      .filter((node) => node.level === 1)
      .map((node) => node.path)
      .sort();

    return {
      nodes: aggregatedNodes,
      rootPaths,
    };
  }
  /**
   * Builds rename chain mapping: old path -> canonical final path.
   *
   * Rules:
   * - Newest rename "wins" and becomes canonical.
   * - All older names collapse to that canonical.
   * - Cycles / ping-pong renames (A→B, B→A) are resolved to
   *   "whatever the file is called most recently".
   *
   * This guarantees we don't split one logical file into two nodes.
   */
  buildRenameChains(activities: FileSystemActivity[]): Map<string, string> {
    // 1. Get only valid rename rows
    // 2. Sort NEWEST first so most recent name is treated as the canonical sink
    const renameActivities = activities
      .filter(
        (activity) =>
          activity.status === "renamed" &&
          activity.previous_filename &&
          activity.merged_at,
      )
      .sort((a, b) => {
        const dateA = new Date(a.merged_at!).getTime();
        const dateB = new Date(b.merged_at!).getTime();
        // descending: newest first
        return dateB - dateA;
      });

    // ultimateMap will directly map ANY historical name to the "final" name
    // Example:
    //   A -> B (older)
    //   B -> A (newer)
    // After sorting desc, we see B->A first, so canonical is A.
    // Then when we process A->B, we map A -> canonicalOf(B) which is A,
    // so both A and B resolve to A.
    const ultimateMap = new Map<string, string>();

    for (const act of renameActivities) {
      const from = act.previous_filename!;
      const to = act.filename;

      // Resolve `to` to whatever canonical we already know.
      // If `to` was already mapped, reuse that canonical sink.
      // Otherwise, `to` is currently the canonical name of itself.
      const canonicalTo = ultimateMap.get(to) ?? to;

      // Map the old name to the canonical new name,
      // BUT don't overwrite if we've already decided a canonical for `from`
      if (!ultimateMap.has(from)) {
        ultimateMap.set(from, canonicalTo);
      }

      // Also make sure `to` itself maps to the same canonical sink.
      // This helps merge multi-hop chains into one sink.
      if (!ultimateMap.has(to)) {
        ultimateMap.set(to, canonicalTo);
      }
    }

    return ultimateMap;
  }
  /**
   * Builds flat activities into hierarchical path structure
   * Creates PathNode entries for all files and their parent directories
   *
   * IMPORTANT: Activities must be processed in chronological order to properly handle
   * file lifecycles. When a file is removed and later re-added, only activities
   * after the most recent removal should be counted in the final stats.
   */
  buildPathNodes(
    activities: FileSystemActivity[],
    renameChains: Map<string, string>,
  ): Map<string, PathNode> {
    const pathNodes = new Map<string, PathNode>();

    // Sort activities chronologically to handle file lifecycles properly
    const sortedActivities = [...activities].sort((a, b) => {
      const dateA = new Date(a.merged_at!).getTime();
      const dateB = new Date(b.merged_at!).getTime();
      return dateA - dateB;
    });

    sortedActivities.forEach((activity) => {
      const ultimateFilename =
        renameChains.get(activity.filename) || activity.filename;
      const pathParts = ultimateFilename.split("/");

      let currentPath = "";
      pathParts.forEach((part, index) => {
        const parentPath = currentPath || null;
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        const isFile = index === pathParts.length - 1;
        const isRemoval = activity.status === "removed";

        if (!pathNodes.has(currentPath)) {
          pathNodes.set(currentPath, {
            path: currentPath,
            name: part,
            level: index + 1,
            type: isFile ? "file" : "folder",
            parent_path: parentPath,
            activities: [],
            children: new Set(),
          });
        }

        // Handle file activities and lifecycle management
        if (isFile) {
          if (isRemoval) {
            // Clear all activities - this ends the current lifecycle
            pathNodes.get(currentPath)!.activities = [];
            // Remove from parent's children set
            if (parentPath) {
              const parentNode = pathNodes.get(parentPath);
              if (parentNode) {
                parentNode.children.delete(currentPath);
              }
            }
          } else {
            // Add activity to current lifecycle
            pathNodes.get(currentPath)!.activities.push(activity);
            // Ensure file is in parent's children set
            if (parentPath) {
              const parentNode = pathNodes.get(parentPath);
              if (parentNode) {
                parentNode.children.add(currentPath);
              }
            }
          }
        } else {
          // For folders, always add to parent's children
          if (parentPath) {
            const parentNode = pathNodes.get(parentPath);
            if (parentNode) {
              parentNode.children.add(currentPath);
            }
          }
        }
      });
    });

    // Clean up files that have no activities (were removed and never re-added)
    pathNodes.forEach((node, path) => {
      if (node.type === "file" && node.activities.length === 0) {
        pathNodes.delete(path);
      }
    });

    // Clean up empty folders (folders with no remaining children)
    // We need to do this iteratively from deepest to shallowest
    let foundEmptyFolder = true;
    while (foundEmptyFolder) {
      foundEmptyFolder = false;
      pathNodes.forEach((node, path) => {
        if (node.type === "folder" && node.children.size === 0) {
          // Remove this empty folder from its parent's children
          if (node.parent_path) {
            const parentNode = pathNodes.get(node.parent_path);
            if (parentNode) {
              parentNode.children.delete(path);
            }
          }
          pathNodes.delete(path);
          foundEmptyFolder = true;
        }
      });
    }

    return pathNodes;
  }

  /**
   * Aggregates stats bottom-up from files to folders
   * Produces final FileSystemNode objects with complete contributor data
   */
  aggregateStatsBottomUp(
    pathNodes: Map<string, PathNode>,
  ): Map<string, FileSystemNode> {
    const result = new Map<string, FileSystemNode>();
    // Internal maps to track unique PR sets per node and per-user PR sets for accurate rollups
    const nodePRs = new Map<string, Set<number>>();
    const nodeUserPRs = new Map<string, Map<string, Set<number>>>();
    // Track recent PR ids (e.g., last 30 days) per node for accurate health rollups
    const nodeRecentPRs = new Map<string, Set<number>>();
    // Initialize recent PR count map for unified health recompute
    this.recentPRCountByPath = new Map<string, number>();

    // First pass: Calculate stats for all files
    pathNodes.forEach((pathNode, path) => {
      if (pathNode.type === "file") {
        const fileStats = this.calculateFileStats(
          pathNode.activities,
          this.userLastSeenByUserId,
        );

        // Track recent PR ids (last 30 days) for rollup
        const recentSet = new Set<number>();
        const cutoff = new Date(
          this.currentNow.getTime() - 30 * 24 * 60 * 60 * 1000,
        );
        pathNode.activities.forEach((a) => {
          if (a.merged_at && new Date(a.merged_at) >= cutoff) {
            recentSet.add(a.gh_issue_id);
          }
        });

        result.set(path, {
          name: pathNode.name,
          path: pathNode.path,
          level: pathNode.level,
          type: "file",
          parent_path: pathNode.parent_path,
          total_files: 1,
          total_adds: fileStats.total_adds,
          total_subs: fileStats.total_subs,
          total_changes: fileStats.total_changes,
          total_prs: fileStats.total_prs,
          total_contributors: fileStats.contributors.length,
          first_seen: fileStats.first_seen,
          last_updated: fileStats.last_updated,
          contributors: fileStats.contributors,
          health: fileStats.health,
        });

        // Track unique PR ids and per-user PR ids for rollup
        nodePRs.set(path, new Set<number>(fileStats.pr_ids));
        nodeUserPRs.set(
          path,
          new Map<string, Set<number>>(fileStats.user_pr_ids),
        );
        nodeRecentPRs.set(path, recentSet);
        this.recentPRCountByPath.set(path, recentSet.size);
      }
    });

    // Find maximum level to process folders from deepest to shallowest
    let maxLevel = 0;
    for (const node of pathNodes.values()) {
      if (node.level > maxLevel) {
        maxLevel = node.level;
      }
    }

    // Second pass: Process folders from deepest to shallowest (bottom-up)
    for (let level = maxLevel; level >= 1; level--) {
      pathNodes.forEach((pathNode, path) => {
        if (pathNode.type === "folder" && pathNode.level === level) {
          const folderStats = this.calculateFolderStats(
            pathNode,
            result,
            nodePRs,
            nodeUserPRs,
            nodeRecentPRs,
          );

          // Skip folders that have no children with temporal data
          // This can happen with directories tracked as files (submodules, symlinks)
          if (folderStats === null) {
            console.log(`Skipping empty folder with no temporal data: ${path}`);
            return;
          }

          // Calculate folder health based on children
          const childNodes = Array.from(pathNode.children)
            .map((childPath) => result.get(childPath))
            .filter((node) => node !== undefined) as FileSystemNode[];
          // Calculate recent PRs rolled up (deduped across children)
          const folderHealth = this.calculateFolderHealth(
            childNodes,
            folderStats.recent_pr_ids.size,
          );

          result.set(path, {
            name: pathNode.name,
            path: pathNode.path,
            level: pathNode.level,
            type: "folder",
            parent_path: pathNode.parent_path,
            total_files: folderStats.total_files,
            total_adds: folderStats.total_adds,
            total_subs: folderStats.total_subs,
            total_changes: folderStats.total_changes,
            total_prs: folderStats.total_prs,
            total_contributors: folderStats.contributors.length,
            first_seen: folderStats.first_seen,
            last_updated: folderStats.last_updated,
            children_count: pathNode.children.size,
            contributors: folderStats.contributors,
            health: folderHealth,
          });

          // Persist computed PR sets for this folder for upper-level rollups
          nodePRs.set(path, new Set<number>(folderStats.pr_ids));
          nodeUserPRs.set(
            path,
            new Map<string, Set<number>>(folderStats.user_pr_ids),
          );
          // Persist recent PR sets for this folder for upper-level rollups
          nodeRecentPRs.set(path, new Set<number>(folderStats.recent_pr_ids));
          this.recentPRCountByPath.set(path, folderStats.recent_pr_ids.size);
        }
      });
    }

    return result;
  }

  private attachRelatedEntities(
    pathNodes: Map<string, PathNode>,
    nodes: Map<string, FileSystemNode>,
  ) {
    const adjacencyByPath =
      this.codeAdjacencyBuilder.buildFileAdjacency(pathNodes);

    adjacencyByPath.forEach((relatedEntities, path) => {
      const node = nodes.get(path);
      if (node?.type === "file") {
        node.related_entities = relatedEntities;
      }
    });
  }

  private attachFileHistory(
    pathNodes: Map<string, PathNode>,
    nodes: Map<string, FileSystemNode>,
  ) {
    pathNodes.forEach((pathNode, path) => {
      if (pathNode.type !== "file") {
        return;
      }

      const history = this.buildFileHistory(pathNode.activities);
      if (history.length === 0) {
        return;
      }

      const node = nodes.get(path);
      if (node?.type === "file") {
        node.history = history;
      }
    });
  }

  private buildFileHistory(
    activities: FileSystemActivity[],
  ): FileHistoryEvent[] {
    return activities
      .filter(
        (activity) =>
          activity.status === "renamed" &&
          activity.previous_filename &&
          activity.merged_at,
      )
      .sort((a, b) => {
        const dateA = new Date(a.merged_at!).getTime();
        const dateB = new Date(b.merged_at!).getTime();
        return dateA - dateB;
      })
      .map((activity) => ({
        kind: this.classifyHistoryEvent(
          activity.previous_filename!,
          activity.filename,
        ),
        from_path: activity.previous_filename!,
        to_path: activity.filename,
        gh_issue_id: activity.gh_issue_id,
        title: activity.title,
        merged_at: new Date(activity.merged_at!).toISOString(),
      }));
  }

  private classifyHistoryEvent(
    fromPath: string,
    toPath: string,
  ): FileHistoryEvent["kind"] {
    const fromParts = fromPath.split("/");
    const toParts = toPath.split("/");
    const fromName = fromParts[fromParts.length - 1];
    const toName = toParts[toParts.length - 1];
    const fromDir = fromParts.slice(0, -1).join("/");
    const toDir = toParts.slice(0, -1).join("/");

    const renamed = fromName !== toName;
    const moved = fromDir !== toDir;

    if (renamed && moved) {
      return "move_and_rename";
    }
    if (moved) {
      return "move";
    }
    return "rename";
  }

  /**
   * Calculates stats for a single file from its activities
   */
  private calculateFileStats(
    activities: FileSystemActivity[],
    userLastSeenByUserId?: Map<number, string>,
  ) {
    const stats = {
      total_adds: 0,
      total_subs: 0,
      total_changes: 0,
      total_prs: 0,
      contributors: [] as FileSystemContributor[],
      first_seen: "",
      last_updated: "",
      health: undefined as NodeHealth | undefined,
      // Internal roll-up helpers
      pr_ids: new Set<number>() as Set<number>,
      user_pr_ids: new Map<string, Set<number>>(),
    };

    if (activities.length === 0) {
      throw new Error(
        `File has no activities - cannot calculate temporal data`,
      );
    }

    // Calculate temporal data from activities - should never be null for merged PRs
    const dates = activities
      .map((activity) => {
        if (activity.merged_at === null) {
          throw new Error(
            `Activity has null merged_at - expected only merged PRs: ${JSON.stringify(
              activity,
            )}`,
          );
        }
        return new Date(activity.merged_at);
      })
      .sort((a, b) => a.getTime() - b.getTime());

    stats.first_seen = dates[0].toISOString();
    stats.last_updated = dates[dates.length - 1].toISOString();

    // Track unique PRs and user stats
    const uniquePRs = new Set<number>();
    const userStats = new Map<
      string,
      {
        total_adds: number;
        total_subs: number;
        total_changes: number;
        prs: Set<number>;
        first_seen?: Date;
        last_seen?: Date;
      }
    >();

    activities.forEach((activity) => {
      if (!activity.merged_at) {
        throw new Error(
          `Activity has null merged_at - expected only merged PRs: ${JSON.stringify(
            activity,
          )}`,
        );
      }
      stats.total_adds += activity.additions;
      stats.total_subs += activity.deletions;
      uniquePRs.add(activity.gh_issue_id);

      if (!userStats.has(activity.gh_login)) {
        userStats.set(activity.gh_login, {
          total_adds: 0,
          total_subs: 0,
          total_changes: 0,
          prs: new Set(),
          first_seen: undefined,
          last_seen: undefined,
        });
      }

      const user = userStats.get(activity.gh_login)!;
      user.total_adds += activity.additions;
      user.total_subs += activity.deletions;
      user.prs.add(activity.gh_issue_id);

      // Track per-user first/last seen in this file (by merged_at)
      const ts = new Date(activity.merged_at);
      if (!user.first_seen || ts < user.first_seen) user.first_seen = ts;
      if (!user.last_seen || ts > user.last_seen) user.last_seen = ts;

      // Track per-user PR ids for roll-up
      if (!stats.user_pr_ids.has(activity.gh_login)) {
        stats.user_pr_ids.set(activity.gh_login, new Set<number>());
      }
      stats.user_pr_ids.get(activity.gh_login)!.add(activity.gh_issue_id);
    });

    stats.total_changes = stats.total_adds + stats.total_subs;
    stats.total_prs = uniquePRs.size;
    stats.pr_ids = uniquePRs;

    // Build contributors array
    stats.contributors = Array.from(userStats.entries())
      .map(([gh_login, user]) => {
        user.total_changes = user.total_adds + user.total_subs;

        // Find user_id for this login to get last_seen_anywhere
        let lastSeenAnywhere = "";
        if (userLastSeenByUserId) {
          const activity = activities.find((a) => a.gh_login === gh_login);
          if (activity) {
            lastSeenAnywhere = userLastSeenByUserId.get(activity.user_id) ?? "";
          }
        }

        return {
          gh_login,
          total_adds: user.total_adds,
          total_subs: user.total_subs,
          total_changes: user.total_changes,
          pct_of_changes:
            stats.total_changes > 0
              ? (user.total_changes / stats.total_changes) * 100
              : 0,
          num_prs: user.prs.size,
          pct_of_prs:
            stats.total_prs > 0 ? (user.prs.size / stats.total_prs) * 100 : 0,
          // Temporal data for this file scope (always present)
          first_seen_in_directory: user.first_seen!.toISOString(),
          last_seen_in_directory: user.last_seen!.toISOString(),
          last_seen_anywhere: lastSeenAnywhere,
        };
      })
      .sort((a, b) => b.total_changes - a.total_changes);

    // Calculate file health
    const recentPRs = this.countRecentPRs(activities, 30, this.currentNow);
    stats.health = this.calculateFileHealth(
      stats.last_updated,
      stats.contributors,
      recentPRs,
      this.currentNow,
    );

    return stats;
  }

  /**
   * Calculates aggregated stats for a folder from its children
   * Returns null if the folder has no children with temporal data (e.g., empty after cleanup)
   */
  private calculateFolderStats(
    folderNode: PathNode,
    processedNodes: Map<string, FileSystemNode>,
    nodePRs: Map<string, Set<number>>,
    nodeUserPRs: Map<string, Map<string, Set<number>>>,
    nodeRecentPRs: Map<string, Set<number>>,
  ) {
    const stats = {
      total_files: 0,
      total_adds: 0,
      total_subs: 0,
      total_changes: 0,
      total_prs: 0,
      contributors: [] as FileSystemContributor[],
      first_seen: "",
      last_updated: "",
    };

    // Aggregate stats from all children
    const userAggregates = new Map<
      string,
      {
        total_adds: number;
        total_subs: number;
        total_changes: number;
        prs: Set<number>;
        first_seen?: Date;
        last_seen?: Date;
      }
    >();

    const uniquePRs = new Set<number>();
    const recentUniquePRs = new Set<number>();
    const childDates: Date[] = [];

    folderNode.children.forEach((childPath) => {
      const childNode = processedNodes.get(childPath);
      if (childNode) {
        stats.total_files += childNode.total_files;
        stats.total_adds += childNode.total_adds;
        stats.total_subs += childNode.total_subs;

        // Collect unique PR IDs from child nodes using precomputed sets
        const childPRs = nodePRs.get(childPath);
        if (childPRs) {
          childPRs.forEach((id) => uniquePRs.add(id));
        }
        // Collect recent PR IDs (deduped across children)
        const childRecent = nodeRecentPRs.get(childPath);
        if (childRecent) {
          childRecent.forEach((id) => recentUniquePRs.add(id));
        }

        // Collect dates for temporal aggregation - should always be present
        childDates.push(new Date(childNode.first_seen));
        childDates.push(new Date(childNode.last_updated));

        // Aggregate contributor data from child node's calculated contributors
        // Use child node contributor totals for adds/subs and union PR sets from precomputed user PR maps
        const childUserPRs = nodeUserPRs.get(childPath);

        if (childNode.contributors) {
          childNode.contributors.forEach((contributor) => {
            if (!userAggregates.has(contributor.gh_login)) {
              userAggregates.set(contributor.gh_login, {
                total_adds: 0,
                total_subs: 0,
                total_changes: 0,
                prs: new Set(),
                first_seen: undefined,
                last_seen: undefined,
              });
            }

            const user = userAggregates.get(contributor.gh_login)!;
            user.total_adds += contributor.total_adds;
            user.total_subs += contributor.total_subs;

            // Union child PR ids for this contributor if available
            const childSet = childUserPRs?.get(contributor.gh_login);
            if (childSet) {
              childSet.forEach((id) => user.prs.add(id));
            }

            // Roll up temporal data: widen first/last seen across children
            if (contributor.first_seen_in_directory) {
              const cFirst = new Date(contributor.first_seen_in_directory);
              if (!user.first_seen || cFirst < user.first_seen) {
                user.first_seen = cFirst;
              }
            }
            if (contributor.last_seen_in_directory) {
              const cLast = new Date(contributor.last_seen_in_directory);
              if (!user.last_seen || cLast > user.last_seen) {
                user.last_seen = cLast;
              }
            }
          });
        }
      }
    });

    stats.total_changes = stats.total_adds + stats.total_subs;
    // Unique PRs across all descendants
    stats.total_prs = uniquePRs.size;

    // Handle case where folder has no children with temporal data
    // This can happen when directories are tracked as files (e.g., submodules, symlinks)
    // and all "files" in the folder are removed
    if (childDates.length === 0) {
      // Return null to signal this folder should be skipped
      return null;
    }

    childDates.sort((a, b) => a.getTime() - b.getTime());
    stats.first_seen = childDates[0].toISOString();
    stats.last_updated = childDates[childDates.length - 1].toISOString();

    // Build contributors array from aggregated data
    stats.contributors = Array.from(userAggregates.entries())
      .map(([gh_login, user]) => {
        user.total_changes = user.total_adds + user.total_subs;
        return {
          gh_login,
          total_adds: user.total_adds,
          total_subs: user.total_subs,
          total_changes: user.total_changes,
          pct_of_changes:
            stats.total_changes > 0
              ? (user.total_changes / stats.total_changes) * 100
              : 0,
          num_prs: user.prs.size,
          pct_of_prs:
            stats.total_prs > 0 ? (user.prs.size / stats.total_prs) * 100 : 0,
          // Temporal data rolled up for this folder scope (always present)
          first_seen_in_directory: user.first_seen!.toISOString(),
          last_seen_in_directory: user.last_seen!.toISOString(),
          last_seen_anywhere: "",
        };
      })
      .sort((a, b) => b.total_changes - a.total_changes);

    return {
      ...stats,
      pr_ids: uniquePRs,
      recent_pr_ids: recentUniquePRs,
      user_pr_ids: new Map(
        Array.from(userAggregates.entries()).map(([login, u]) => [
          login,
          new Set(u.prs),
        ]),
      ),
    };
  }

  /**
   * Enriches node contributors with last_seen_anywhere using a map of user_id -> ISO timestamp.
   * Builds a gh_login -> user_id map from the activities for lookup.
   */
  private populateContributorLastSeenAnyWhere(
    nodes: Map<string, FileSystemNode>,
    activities: FileSystemActivity[],
    userLastSeenByUserId: Map<number, string>,
  ) {
    const loginToUserId = new Map<string, number>();
    for (const a of activities) {
      if (!loginToUserId.has(a.gh_login)) {
        loginToUserId.set(a.gh_login, a.user_id);
      }
    }

    nodes.forEach((node) => {
      if (!node.contributors) return;
      node.contributors.forEach((contributor) => {
        const uid = loginToUserId.get(contributor.gh_login);
        if (uid !== undefined) {
          contributor.last_seen_anywhere = userLastSeenByUserId.get(uid) ?? "";
        }
      });
    });

    // Validate all contributors have last_seen_anywhere populated; fail loudly if not
    nodes.forEach((node) => {
      if (!node.contributors) return;
      node.contributors.forEach((contributor) => {
        if (!contributor.last_seen_anywhere) {
          throw new Error(
            `Missing last_seen_anywhere for contributor ${contributor.gh_login}`,
          );
        }
      });
    });
  }

  /**
   * Calculates health status for a single file based on activity and contributor recency
   */
  private calculateFileHealth(
    lastUpdated: string,
    contributors: FileSystemContributor[],
    recentPRs: number,
    now: Date = new Date(),
  ): NodeHealth {
    const lastUpdatedDate = new Date(lastUpdated);
    const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    // Configurable threshold for caution state (18 months = 540 days)
    const cautionThresholdDays = 540;
    const eighteenMonthsAgo = new Date(
      now.getTime() - cautionThresholdDays * 24 * 60 * 60 * 1000,
    );

    // Critical: All contributors inactive for >3 months
    const allContributorsInactive = contributors.every(
      (c) => new Date(c.last_seen_anywhere) < threeMonthsAgo,
    );
    if (allContributorsInactive && contributors.length > 0) {
      return {
        state: "critical",
        reason: "No active contributors in the past 3 months",
      };
    }

    // Warn: >75% of changes from contributors inactive for >3 months
    const inactiveContributorChanges = contributors
      .filter((c) => new Date(c.last_seen_anywhere) < threeMonthsAgo)
      .reduce((sum, c) => sum + c.pct_of_changes, 0);
    if (inactiveContributorChanges > 75) {
      return {
        state: "warn",
        reason: `Most changes authored by inactive contributors (${Math.round(
          inactiveContributorChanges,
        )}%)`,
      };
    }

    // Caution: Last updated >18 months ago
    if (lastUpdatedDate < eighteenMonthsAgo) {
      return {
        state: "caution",
        reason: "No changes in 18+ months",
      };
    }

    // Good: >10 PRs in last 30 days
    if (recentPRs > 10) {
      return {
        state: "good",
        reason: `${recentPRs} merged PRs in the last 30 days`,
      };
    }

    // Neutral: Default
    return {
      state: "neutral",
      reason: "Moderate activity",
    };
  }

  /**
   * Calculates health status for a folder based on its children's health (healthiest wins)
   */
  private calculateFolderHealth(
    childNodes: FileSystemNode[],
    recentPRs: number,
    _now: Date = new Date(),
  ): NodeHealth {
    // This function remains as a fallback during aggregation pre-enrichment.
    // Final folder health is recalculated after contributors are enriched.
    // Still provide early recognition of high activity.
    if (recentPRs > 10) {
      return {
        state: "good",
        reason: `${recentPRs} merged PRs in the last 30 days`,
      };
    }
    if (childNodes.length === 0) {
      return { state: "neutral", reason: "No child files" };
    }

    // Collect all child health states
    const childHealths = childNodes
      .map((child) => child.health)
      .filter((health) => health !== undefined) as NodeHealth[];

    if (childHealths.length === 0) {
      return { state: "neutral", reason: "No health data from children" };
    }

    // Severity ranking: critical > warn > caution > neutral > good
    const severityOrder = {
      critical: 5,
      warn: 4,
      caution: 3,
      neutral: 2,
      good: 1,
    };

    // Find the healthiest (least severe) state
    const healthiest = childHealths.reduce((best, current) => {
      return severityOrder[current.state] < severityOrder[best.state]
        ? current
        : best;
    });

    return {
      state: healthiest.state,
      reason: `Inherited from healthiest child: ${healthiest.reason}`,
    };
  }

  /**
   * Recompute folder health using aggregated stats and enriched contributors.
   * Applies the same rules used for files, but based on folder aggregates.
   */
  private recomputeFolderHealth(nodes: Map<string, FileSystemNode>) {
    nodes.forEach((node) => {
      if (node.type !== "folder") return;
      const recent = this.recentPRCountByPath?.get(node.path) ?? 0;
      const contributors = node.contributors ?? [];
      node.health = this.calculateFileHealth(
        node.last_updated,
        contributors,
        recent,
        this.currentNow,
      );
    });
  }

  /**
   * Counts PRs in the last N days for a file's activities
   */
  private countRecentPRs(
    activities: FileSystemActivity[],
    days: number,
    now: Date,
  ): number {
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const recentPRIds = new Set<number>();

    activities.forEach((activity) => {
      if (activity.merged_at && new Date(activity.merged_at) >= cutoff) {
        recentPRIds.add(activity.gh_issue_id);
      }
    });

    return recentPRIds.size;
  }
}
