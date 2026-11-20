import { z } from "zod";

// Health status for filesystem nodes
export const NodeHealthSchema = z.object({
  state: z.enum(["critical", "warn", "caution", "neutral", "good"]),
  reason: z.string(),
});
export type NodeHealth = z.infer<typeof NodeHealthSchema>;

// Individual contributor stats within a file or folder
export const FileSystemContributorSchema = z.object({
  gh_login: z.string(),
  total_adds: z.number(),
  total_subs: z.number(),
  total_changes: z.number(),
  pct_of_changes: z.number(), // % of this file/folder's changes
  num_prs: z.number(),
  pct_of_prs: z.number(), // % of this file/folder's PRs

  // Temporal data for ownership recency analysis
  first_seen_in_directory: z.string(), // When first touched file in this dir/subdir (ISO string)
  last_seen_in_directory: z.string(), // When last touched file in this dir/subdir (ISO string)
  last_seen_anywhere: z.string(), // From user_activity table - last activity in entire repo
});
export type FileSystemContributor = z.infer<typeof FileSystemContributorSchema>;

export const RelatedEntitySharedPRSchema = z.object({
  gh_issue_id: z.coerce.number(),
  title: z.string(),
  merged_at: z.string(),
});
export type RelatedEntitySharedPR = z.infer<typeof RelatedEntitySharedPRSchema>;

export const RelatedEntitySchema = z.object({
  path: z.string(),
  type: z.enum(["file", "folder"]),
  shared_prs: z.number(),
  cochange_pct: z.number(),
  recent_shared_prs: z.array(RelatedEntitySharedPRSchema),
});
export type RelatedEntity = z.infer<typeof RelatedEntitySchema>;

export const FileHistoryEventSchema = z.object({
  kind: z.enum(["rename", "move", "move_and_rename"]),
  from_path: z.string(),
  to_path: z.string(),
  gh_issue_id: z.coerce.number(),
  title: z.string(),
  merged_at: z.string(),
});
export type FileHistoryEvent = z.infer<typeof FileHistoryEventSchema>;

// Individual filesystem node (file or folder)
export const FileSystemNodeSchema = z.object({
  name: z.string(), // "services" or "auth.ts"
  path: z.string(), // "backend/services" or "backend/services/auth.ts"
  level: z.number(), // 1, 2, 3...
  type: z.enum(["folder", "file"]),
  parent_path: z.string().nullable(),

  // Stats (always present for both folders and files)
  total_files: z.number(), // For folders: descendant count, Files: always 1
  total_adds: z.number(),
  total_subs: z.number(),
  total_changes: z.number(),
  total_prs: z.number(),
  total_contributors: z.number(),

  // Temporal data - always present, will fail loudly if not set
  first_seen: z.string(), // ISO date string of earliest activity
  last_updated: z.string(), // ISO date string of most recent activity

  // Optional: for folders only
  // DAN TODO: IS this necessary?
  children_count: z.number().optional(),

  // Contributors breakdown (for both files and folders)
  // For folders: aggregated stats from all descendant files
  // For files: individual file contributor breakdown
  contributors: z.array(FileSystemContributorSchema).optional(),

  // Health status based on activity and contributor recency
  health: NodeHealthSchema.optional(),

  // Related files/folders that frequently change with this node
  related_entities: z.array(RelatedEntitySchema).optional(),

  // File-only rename/move history, stored only when a file has changed identity
  history: z.array(FileHistoryEventSchema).optional(),
});
export type FileSystemNode = z.infer<typeof FileSystemNodeSchema>;

// API response for filesystem tree requests
export const FileSystemTreeResponseSchema = z.object({
  parent_path: z.string(), // "" for root, "backend" for backend/, etc
  requested_levels: z.array(z.number()), // [1,2]
  nodes: z.array(FileSystemNodeSchema),
});
export type FileSystemTreeResponse = z.infer<
  typeof FileSystemTreeResponseSchema
>;

// Individual PR that touched a filesystem path
export const FileSystemPRSchema = z.object({
  gh_issue_id: z.coerce.number(), // GitHub PR number
  title: z.string(),
  gh_login: z.string(), // PR author
  created_at: z
    .union([z.string(), z.date()])
    .transform((d) => (d instanceof Date ? d.toISOString() : d)),
  merged_at: z
    .union([z.string(), z.date()])
    .transform((d) => (d instanceof Date ? d.toISOString() : d)),
  additions: z.number(),
  deletions: z.number(),
  changed_files: z.number(),
  comments: z.coerce.number(), // comment_count + review_comment_count
});
export type FileSystemPR = z.infer<typeof FileSystemPRSchema>;

// API response for filesystem PR list requests
export const FileSystemPRsResponseSchema = z.object({
  path: z.string(),
  type: z.enum(["file", "folder"]),
  prs: z.array(FileSystemPRSchema),
  total: z.number(), // total_prs from precomputed node (for UI "showing X of Y")
  limit: z.number(),
  offset: z.number(),
});
export type FileSystemPRsResponse = z.infer<typeof FileSystemPRsResponseSchema>;
