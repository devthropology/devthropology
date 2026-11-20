import { User } from "../models/gh/user.ts";
import { HydratedIssue } from "../models/gh/issue.ts";
import {
  AuthorStats,
  ComputedFileSystemNode,
  ComputedRepositoryOverview,
  FileSystemActivity,
  FullIssue,
  FullPullRequest,
  MergesByDay,
  PrTiming,
  RenamedFileForBackfill,
  RepositoryDetails,
  ReviewerStats,
  UserActivity,
  UserActivityOverview,
  UserIssueStats,
  UserPullStatsDb,
  UserStatsForUi,
} from "../models/dbTypes.ts";
import { MonthlyMetricPoint } from "../../shared/models/userMonthlyMetrics.ts";
import { FileSystemPR } from "../../shared/models/fileSystemTree.ts";
import { PullRequestEnhancedStats } from "../../shared/models/pullRequestEnhancedStats.ts";

export type DbRow = Record<string, unknown>;

export interface IRepository {
  close(): Promise<void>;
  updateRepositoryDetails(org: string, repo: string): void;
  getRepositoryDetails(): Promise<RepositoryDetails[]>;
  getOrCreateUsers(users: User[]): Promise<Map<number, number>>;
  collectUniqueUsers(issue: HydratedIssue): User[];
  insertIssue(
    issue: HydratedIssue,
    stats: PullRequestEnhancedStats | number,
  ): Promise<void>;
  getLowestIssueId(): Promise<number>;
  getClosedIssues(): Promise<number[]>;
  getOpenNonPullRequestIssues(): Promise<number[]>;
  getOpenPullRequestsToSkip(userName: string, created: Date): Promise<number[]>;
  getAllProcessedPullRequests(userName: string): Promise<number[]>;
  getFullIssue(ghIssueNumber: number): Promise<FullIssue | FullPullRequest>;
  getIssue(ghIssueNumber: number): Promise<DbRow>;
  getReviewerStats(
    startDate: Date,
    endDate: Date,
    repositoryId: number,
    reviewerUsernames?: string[],
  ): Promise<ReviewerStats[]>;
  getUserActivity(repositoryId: number): Promise<UserActivity[]>;
  updateUserActivity(): Promise<void>;
  getAuthorStats(
    startDate: Date,
    endDate: Date,
    repositoryId: number,
    authorUsernames?: string[],
  ): Promise<AuthorStats[]>;
  getContributorAgeBuckets(
    startDate: Date,
    endDate: Date,
    repositoryId: number,
  ): Promise<Array<{ bucket: string; count: number }>>;
  getUserActivityOverview(
    repositoryId: number,
  ): Promise<UserActivityOverview[]>;
  getDailyMergeMetrics(
    startDate: Date,
    endDate: Date,
    repositoryId: number,
  ): Promise<MergesByDay[]>;
  getMergedPrTiming(
    startDate: Date,
    endDate: Date,
    repositoryId: number,
  ): Promise<PrTiming[]>;
  getUserStatsForUi(
    repositoryId: number,
    username: string,
  ): Promise<UserStatsForUi>;
  getUserPullStats(
    repositoryId: number,
    username: string,
    limit: number,
    offset?: number,
  ): Promise<UserPullStatsDb>;
  getUserIssueReviews(
    repositoryId: number,
    username: string,
    limit: number,
    offset?: number,
  ): Promise<UserIssueStats>;
  getRenamedFilesForBackfill(
    repositoryId: number,
    limit: number,
  ): Promise<RenamedFileForBackfill[]>;
  updatePreviousFilename(
    pullRequestFileId: number,
    previousFilename: string,
  ): Promise<void>;
  getDirectoryStats(
    repositoryId: number,
    directoryPath: string,
  ): Promise<FileSystemActivity[]>;
  getRepositoryOverview(
    repositoryId: number,
  ): Promise<ComputedRepositoryOverview | null>;
  updateRepositoryOverview(repositoryId: number): Promise<void>;
  persistFileSystem(
    repositoryId: number,
    nodes: ComputedFileSystemNode[],
  ): Promise<void>;
  getFileSystemNodes(
    repositoryId: number,
    parentPath: string | null,
    levels: number[],
  ): Promise<ComputedFileSystemNode[]>;
  getFileSystemNodeByPath(
    repositoryId: number,
    path: string,
  ): Promise<ComputedFileSystemNode | null>;
  getUserMonthlyMergedPrs(
    repositoryId: number,
    username: string,
  ): Promise<MonthlyMetricPoint[]>;
  getUserMonthlyLinesModified(
    repositoryId: number,
    username: string,
  ): Promise<MonthlyMetricPoint[]>;
  getUserMonthlyPrsReviewed(
    repositoryId: number,
    username: string,
  ): Promise<MonthlyMetricPoint[]>;
  getUserMonthlyPrComments(
    repositoryId: number,
    username: string,
  ): Promise<MonthlyMetricPoint[]>;
  getFileSystemPRs(
    repositoryId: number,
    path: string,
    type: "file" | "folder",
    limit: number,
    offset: number,
  ): Promise<FileSystemPR[]>;
}

export { PostgresRepository } from "./postgresRepository.ts";
