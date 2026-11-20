export interface UserActivityByMonth {
  month: string;
  new_contributors: number;
  stopped_contributors: number;
  active_users: number;
  active_details: Array<{ login: string; date: string }>;
  first_seen_details: Array<{ login: string; date: string }>;
  last_seen_details: Array<{ login: string; date: string }>;
}

export interface UserActivityOverview {
  git_repo: string;
  gh_login: string;
  first_seen_timestamp: string;
  first_seen_issue_id: number;
  first_seen_activity_type: string;
  first_seen_title: string;
  last_seen_timestamp: string;
  last_seen_issue_id: number;
  last_seen_activity_type: string;
  last_seen_title: string;
  prs_merged: number;
  prs_merged_rank: number | null;
  lines_modified: number;
  lines_modified_rank: number | null;
  prs_reviewed: number;
  prs_reviewed_rank: number | null;
  pr_comments: number;
  pr_comments_rank: number | null;
}

export interface RecentPull {
  gh_issue_id: number;
  title: string;
  status: "open" | "closed" | "merged";
  created_at: string;
  closed_at?: string | null;
  additions?: number | null;
  deletions?: number | null;
  changed_files?: number | null;
  rounds_of_review?: number | null;
  author_comments?: number | null;
  non_author_comments?: number | null;
  bot_comments?: number | null;
  first_review_time?: string | null;
}

export interface UserStatsForUi {
  issue_count: number;
  pull_request_count: number;
  merged_pull_count: number;
  open_pull_count: number;
  repo_owner: string;
  repo_name: string;
  first_seen_timestamp: string | null;
  last_seen_timestamp: string | null;
  user_position: number;
  total_unique_users: number;
}

// --- Repository Details ---

export interface RepositoryDetails {
  id: string;
  name: string;
  org: string;
  lastSyncAt?: string | null;
}
