import {
  MergesByDay,
  PrTiming,
  RepositoryDetails,
  UserStatsForUi,
} from "./models/dbTypes.ts";
import {
  AuthorStatsResponse,
  ComputedUserMetrics,
  ContributorAgeBucket,
  DashboardData,
  FileSystemPRsResponse,
  FileSystemTreeResponse,
  GithubUser,
  RepositoryOverview,
  ReviewerStatsResponse,
  transformRepositoryOverview,
  UserMonthlyMetrics,
  UserPullStats,
  UserPullStatsSchema,
  UserReviewStats,
  UserReviewStatsSchema,
  VolumeSnapshot,
  WeeklyVolume,
} from "../shared/models/index.ts";
import { subMonths } from "date-fns";
import { IRepository, PostgresRepository } from "./repository/repository.ts";
import { FileSystemService } from "./services/fileSystemService.ts";
import { GhApi } from "./api/ghApi.ts";
import { ComputedUserMetricsRepository } from "./repository/computedUserMetricsRepository.ts";
import { buildReviewerStatsResponse } from "./services/reviewerStatsCalculator.ts";
import { buildAuthorStatsResponse } from "./services/authorStatsCalculator.ts";
import { toGithubUser } from "./util/githubUserProfile.ts";
import { GithubUserFetchError } from "./models/errors/GithubUserFetchError.ts";
import { RateExceededError } from "./models/errors/RateExceededError.ts";

const EASTERN_TIME_ZONE = "America/New_York" as const;
const EASTERN_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: EASTERN_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const AGE_BUCKETS = [
  { key: "new", title: "New", range: "0-90d", maxDays: 90 },
  { key: "emerging", title: "Emerging", range: "90d-1y", maxDays: 365 },
  { key: "core", title: "Core", range: "1-2y", maxDays: 730 },
  { key: "established", title: "Established", range: "2-5y", maxDays: 1825 },
  { key: "veteran", title: "Veteran", range: "5y+", maxDays: Infinity },
] as const;

function bucketAgeDays(ageDays: number) {
  for (const bucket of AGE_BUCKETS) {
    if (ageDays < bucket.maxDays) {
      return bucket;
    }
  }
  return null;
}

export class Service {
  private repository: IRepository;
  // Temporary seam for isolating expensive report queries onto a dedicated DB pool.
  // See https://github.com/dpclark4/gh-track/issues/327.
  // TODO: Move author/reviewer reports into backend/features/reports.
  private reportsRepository: IRepository;
  private fileSystemService: FileSystemService;
  private ghApi?: GhApi;
  private computedUserMetricsRepository: ComputedUserMetricsRepository;

  constructor(
    repository: IRepository,
    ghApi: GhApi | undefined,
    computedUserMetricsRepository: ComputedUserMetricsRepository,
    reportsRepository: IRepository = repository,
  ) {
    this.repository = repository;
    this.reportsRepository = reportsRepository;
    this.ghApi = ghApi;
    this.fileSystemService = new FileSystemService(repository);
    this.computedUserMetricsRepository = computedUserMetricsRepository;
  }

  async getUserActivityOverview(repositoryId: number) {
    const userActivity =
      await this.repository.getUserActivityOverview(repositoryId);
    userActivity.sort(
      (a, b) =>
        b.last_seen_timestamp.getTime() - a.last_seen_timestamp.getTime(),
    );
    return userActivity;
  }

  async getAuthorStats(
    startDate: Date,
    endDate: Date,
    repositoryId: number,
    authorUsernames?: string[],
  ): Promise<AuthorStatsResponse> {
    if (startDate > endDate) {
      throw new Error("startDate must be before endDate");
    }

    console.log(`Service: Getting author stats for repository ${repositoryId}`);

    const normalizedUsernames = authorUsernames
      ?.flatMap((username) => username.split(","))
      .map((username) => username.trim())
      .filter((username) => username.length > 0);
    const filterParam =
      normalizedUsernames && normalizedUsernames.length > 0
        ? Array.from(new Set(normalizedUsernames))
        : undefined;

    const stats = await this.reportsRepository.getAuthorStats(
      startDate,
      endDate,
      repositoryId,
      filterParam,
    );
    return buildAuthorStatsResponse(stats, {
      includeThresholds: !filterParam,
    });
  }

  async getReviewStats(
    startDate: Date,
    endDate: Date,
    repositoryId: number,
    reviewerUsernames?: string[],
  ): Promise<ReviewerStatsResponse> {
    const normalizedUsernames = reviewerUsernames
      ?.flatMap((username) => username.split(","))
      .map((username) => username.trim())
      .filter((username) => username.length > 0);
    const filterParam =
      normalizedUsernames && normalizedUsernames.length > 0
        ? Array.from(new Set(normalizedUsernames))
        : undefined;
    const stats = await this.reportsRepository.getReviewerStats(
      startDate,
      endDate,
      repositoryId,
      filterParam,
    );
    return buildReviewerStatsResponse(stats, {
      includeThresholds: !filterParam,
    });
  }

  async getMergesByDay(
    startDate: Date,
    endDate: Date,
    repositoryId: number,
  ): Promise<MergesByDay[]> {
    if (startDate > endDate) {
      throw new Error("startDate must be before endDate");
    }
    return await this.repository.getDailyMergeMetrics(
      startDate,
      endDate,
      repositoryId,
    );
  }

  async getUserStatsForUi(
    username: string,
    repositoryId: number,
  ): Promise<UserStatsForUi> {
    return await this.repository.getUserStatsForUi(repositoryId, username);
  }

  async getUserPullStats(
    username: string,
    limit: number,
    repositoryId: number,
    offset: number = 0,
  ): Promise<UserPullStats> {
    const dbStats = await this.repository.getUserPullStats(
      repositoryId,
      username,
      limit,
      offset,
    );

    const rawData = {
      recentPulls: dbStats.recent_pulls.map((pull) => ({
        issueId: pull.gh_issue_id,
        title: pull.title,
        status: pull.status,
        createdAt: pull.created_at.toISOString(),
        closedAt: pull.closed_at?.toISOString() ?? null,
        additions: pull.additions ?? null,
        deletions: pull.deletions ?? null,
        changedFiles: pull.changed_files ?? null,
        roundsOfReview: pull.rounds_of_review ?? null,
        botRoundsOfReview: pull.bot_rounds_of_review ?? null,
        authorComments: pull.author_comments ?? null,
        nonAuthorComments: pull.non_author_comments ?? null,
        botComments: pull.bot_comments ?? null,
        firstReviewTime: pull.first_review_time?.toISOString() ?? null,
        firstApprovalTime: pull.first_approval_time?.toISOString() ?? null,
      })),
      repoOwner: dbStats.repo_owner,
      repoName: dbStats.repo_name,
    };

    return UserPullStatsSchema.parse(rawData);
  }

  async getRepositoryDetails(): Promise<RepositoryDetails[]> {
    return await this.repository.getRepositoryDetails();
  }

  async getComputedUserMetrics(
    repositoryId: number,
    username: string,
  ): Promise<ComputedUserMetrics> {
    return await this.computedUserMetricsRepository.getMetricsForUser(
      repositoryId,
      username,
    );
  }

  async getUserMonthlyMetrics(
    repositoryId: number,
    username: string,
  ): Promise<UserMonthlyMetrics> {
    const [prsMerged, linesModified, prsReviewed, prComments] =
      await Promise.all([
        this.repository.getUserMonthlyMergedPrs(repositoryId, username),
        this.repository.getUserMonthlyLinesModified(repositoryId, username),
        this.repository.getUserMonthlyPrsReviewed(repositoryId, username),
        this.repository.getUserMonthlyPrComments(repositoryId, username),
      ]);

    // Collect all unique months across all metrics and sort them
    const monthSet = new Set<string>();
    for (const point of prsMerged) monthSet.add(point.month);
    for (const point of linesModified) monthSet.add(point.month);
    for (const point of prsReviewed) monthSet.add(point.month);
    for (const point of prComments) monthSet.add(point.month);

    const sortedMonths = Array.from(monthSet).sort();

    // Fill in any gaps between the first and last month
    const months: string[] = [];
    if (sortedMonths.length > 0) {
      const [startYear, startMonth] = sortedMonths[0].split("-").map(Number);
      const [endYear, endMonth] = sortedMonths[sortedMonths.length - 1]
        .split("-")
        .map(Number);
      let y = startYear;
      let m = startMonth;
      while (y < endYear || (y === endYear && m <= endMonth)) {
        months.push(`${y}-${String(m).padStart(2, "0")}`);
        m++;
        if (m > 12) {
          m = 1;
          y++;
        }
      }
    }

    // Build lookup maps for each metric
    const mergedMap = new Map(prsMerged.map((p) => [p.month, p.value]));
    const linesMap = new Map(linesModified.map((p) => [p.month, p.value]));
    const reviewedMap = new Map(prsReviewed.map((p) => [p.month, p.value]));
    const commentsMap = new Map(prComments.map((p) => [p.month, p.value]));

    return {
      months,
      prsMerged: months.map((m) => mergedMap.get(m) ?? 0),
      linesModified: months.map((m) => linesMap.get(m) ?? 0),
      prsReviewed: months.map((m) => reviewedMap.get(m) ?? 0),
      prCommentsAdded: months.map((m) => commentsMap.get(m) ?? 0),
    };
  }

  async getUserReviewStats(
    username: string,
    limit: number,
    repositoryId: number,
    offset: number = 0,
  ): Promise<UserReviewStats> {
    const dbStats = await this.repository.getUserIssueReviews(
      repositoryId,
      username,
      limit,
      offset,
    );

    // Transform DB model to response model and apply Zod validation/preprocessing
    const rawData = {
      recentReviews: dbStats.recent_issue_reviews.map((review) => ({
        issueId: review.gh_issue_id,
        title: review.title,
        authorLogin: review.author_login,
        createdAt: review.created_at.toISOString(),
        status: review.status,
        additions: review.additions,
        deletions: review.deletions,
        changedFiles: review.changed_files,
        roundsOfReview: review.rounds_of_review,
        reviewStatus: review.review_status,
        wasFirstReviewer: review.was_first_reviewer,
        timeToFirstReview: review.time_to_first_review,
        authorComments: review.author_comments,
        reviewerComments: review.reviewer_comments,
        otherUserComments: review.other_user_comments,
        botComments: review.bot_comments,
      })),
      repoOwner: dbStats.repo_owner,
      repoName: dbStats.repo_name,
    };

    // Apply Zod validation to trigger preprocessing (e.g., review status transformation)
    return UserReviewStatsSchema.parse(rawData);
  }

  /**
   * Gets filesystem tree with progressive loading support
   */
  async getFileSystemTree(
    repositoryId: number,
    parentPath: string,
    levels: number[],
  ): Promise<FileSystemTreeResponse> {
    return await this.fileSystemService.getFileSystemTree(
      repositoryId,
      parentPath,
      levels,
    );
  }

  /**
   * Gets PRs that touch a specific filesystem path
   */
  async getFileSystemPRs(
    repositoryId: number,
    path: string,
    type: "file" | "folder",
    limit: number,
    offset: number,
  ): Promise<FileSystemPRsResponse> {
    return await this.fileSystemService.getFileSystemPRs(
      repositoryId,
      path,
      type,
      limit,
      offset,
    );
  }

  async getGithubUserProfile(username: string): Promise<GithubUser> {
    // Try to serve from the local profile table first
    let cachedProfile: {
      avatar_url: string | null;
      name: string | null;
      company: string | null;
      location: string | null;
      email: string | null;
      github_created_at: string | null;
      synced_at: string;
    } | null = null;
    if (this.repository instanceof PostgresRepository) {
      try {
        cachedProfile = await (
          this.repository as PostgresRepository
        ).getUserProfileByLogin(username);
        const hasHydratedSnapshot =
          cachedProfile &&
          (cachedProfile.github_created_at !== null ||
            cachedProfile.avatar_url === null);
        if (cachedProfile && hasHydratedSnapshot) {
          return {
            login: username,
            name: cachedProfile.name,
            avatar_url:
              cachedProfile.avatar_url ?? `https://github.com/${username}.png`,
            company: cachedProfile.company,
            location: cachedProfile.location,
            email: cachedProfile.email,
            created_at:
              cachedProfile.github_created_at ?? cachedProfile.synced_at,
            html_url: `https://github.com/${username}`,
          };
        }
      } catch (error) {
        console.error(
          `DB profile lookup failed for ${username}, falling back to GitHub API:`,
          error,
        );
      }
    }

    // Fall back to live GitHub API
    if (!this.ghApi) {
      // No API client and no DB profile — return a placeholder
      return {
        login: username,
        name: cachedProfile?.name ?? null,
        avatar_url:
          cachedProfile?.avatar_url ?? `https://github.com/${username}.png`,
        company: cachedProfile?.company ?? null,
        location: cachedProfile?.location ?? null,
        email: cachedProfile?.email ?? null,
        created_at:
          cachedProfile?.github_created_at ??
          cachedProfile?.synced_at ??
          new Date().toISOString(),
        html_url: `https://github.com/${username}`,
      };
    }

    try {
      const profile = await this.ghApi.getUserProfile(username);
      return toGithubUser(profile);
    } catch (error) {
      if (
        error instanceof GithubUserFetchError ||
        error instanceof RateExceededError
      ) {
        throw error;
      }

      console.error(`GitHub API getUserProfile failed for ${username}:`, error);
      // Return a placeholder so the UI doesn't break
      return {
        login: username,
        name: cachedProfile?.name ?? null,
        avatar_url:
          cachedProfile?.avatar_url ?? `https://github.com/${username}.png`,
        company: cachedProfile?.company ?? null,
        location: cachedProfile?.location ?? null,
        email: cachedProfile?.email ?? null,
        created_at:
          cachedProfile?.github_created_at ??
          cachedProfile?.synced_at ??
          new Date().toISOString(),
        html_url: `https://github.com/${username}`,
      };
    }
  }

  async getDashboardData(
    repositoryId: number,
    now: Date,
    months: number,
  ): Promise<DashboardData> {
    const overallStart = performance.now();
    const timings: { label: string; ms: number }[] = [];
    const recordTiming = (label: string, duration: number) => {
      timings.push({ label, ms: duration });
    };
    const timeAsync = async <T>(
      label: string,
      fn: () => Promise<T>,
    ): Promise<T> => {
      const start = performance.now();
      try {
        return await fn();
      } finally {
        recordTiming(label, performance.now() - start);
      }
    };
    const timeSync = <T>(label: string, fn: () => T): T => {
      const start = performance.now();
      try {
        return fn();
      } finally {
        recordTiming(label, performance.now() - start);
      }
    };

    const startDate = subMonths(now, months);

    const [dailyMergeMetrics, mergedPrTiming, contributorAgeBucketsRaw] =
      await Promise.all([
        timeAsync("fetchDailyMergeMetrics", () =>
          this.repository.getDailyMergeMetrics(startDate, now, repositoryId),
        ),
        timeAsync("fetchMergedPrTiming", () =>
          this.repository.getMergedPrTiming(startDate, now, repositoryId),
        ),
        timeAsync("fetchContributorAgeBuckets", () =>
          this.repository.getContributorAgeBuckets(
            startDate,
            now,
            repositoryId,
          ),
        ),
      ]);

    const dailyMerges = timeSync("sortDailyMergeMetrics", () =>
      dailyMergeMetrics
        .slice()
        .sort((a, b) => a.merge_date.getTime() - b.merge_date.getTime()),
    );
    const contributorAgeSamples = timeSync("countContributorAgeSamples", () =>
      dailyMerges.reduce(
        (total, day) => total + (day.contributor_ages?.length ?? 0),
        0,
      ),
    );
    const prTimingData = timeSync("sortMergedPrTiming", () =>
      mergedPrTiming
        .slice()
        .sort((a, b) => a.merged_at.getTime() - b.merged_at.getTime()),
    );

    // Aggregate daily data into weekly trends (Monday-based weeks)
    // Calculate weeks: ~4.33 weeks per month
    const weeks = Math.ceil(months * 4.33);
    const weeklyTrends = timeSync("aggregateWeeklyTrends", () =>
      this.aggregateToWeeklyTrends(dailyMerges, prTimingData, weeks),
    );

    // Calculate current vs prior period snapshots
    const current7d = timeSync("snapshotCurrent7d", () =>
      this.calculatePeriodSnapshot(dailyMerges, prTimingData, 7, now),
    );
    const prior7d = timeSync("snapshotPrior7d", () =>
      this.calculatePeriodSnapshot(dailyMerges, prTimingData, 7, now, 7),
    ); // 7 days ago, for 7 days
    const current30d = timeSync("snapshotCurrent30d", () =>
      this.calculatePeriodSnapshot(dailyMerges, prTimingData, 30, now),
    );
    const prior30d = timeSync("snapshotPrior30d", () =>
      this.calculatePeriodSnapshot(dailyMerges, prTimingData, 30, now, 30),
    ); // 30 days ago, for 30 days

    // Calculate percentage changes
    current7d.prsMergedChangePercent = this.calculatePercentChange(
      prior7d.prsMerged,
      current7d.prsMerged,
    );
    current7d.linesAddedChangePercent = this.calculatePercentChange(
      prior7d.linesAdded,
      current7d.linesAdded,
    );
    current7d.linesDeletedChangePercent = this.calculatePercentChange(
      prior7d.linesDeleted,
      current7d.linesDeleted,
    );
    current7d.filesChangedChangePercent = this.calculatePercentChange(
      prior7d.filesChanged,
      current7d.filesChanged,
    );

    current30d.prsMergedChangePercent = this.calculatePercentChange(
      prior30d.prsMerged,
      current30d.prsMerged,
    );
    current30d.linesAddedChangePercent = this.calculatePercentChange(
      prior30d.linesAdded,
      current30d.linesAdded,
    );
    current30d.linesDeletedChangePercent = this.calculatePercentChange(
      prior30d.linesDeleted,
      current30d.linesDeleted,
    );
    current30d.filesChangedChangePercent = this.calculatePercentChange(
      prior30d.filesChanged,
      current30d.filesChanged,
    );
    current7d.avgTimeToMergeHoursChangePercent = this.calculatePercentChange(
      prior7d.avgTimeToMergeHours,
      current7d.avgTimeToMergeHours,
    );
    current7d.medianTimeToMergeHoursChangePercent = this.calculatePercentChange(
      prior7d.medianTimeToMergeHours,
      current7d.medianTimeToMergeHours,
    );
    current7d.avgContributorAgeDaysChangePercent = this.calculatePercentChange(
      prior7d.avgContributorAgeDays,
      current7d.avgContributorAgeDays,
    );
    current7d.medianContributorAgeDaysChangePercent =
      this.calculatePercentChange(
        prior7d.medianContributorAgeDays,
        current7d.medianContributorAgeDays,
      );
    current30d.avgTimeToMergeHoursChangePercent = this.calculatePercentChange(
      prior30d.avgTimeToMergeHours,
      current30d.avgTimeToMergeHours,
    );
    current30d.medianTimeToMergeHoursChangePercent =
      this.calculatePercentChange(
        prior30d.medianTimeToMergeHours,
        current30d.medianTimeToMergeHours,
      );
    current30d.avgContributorAgeDaysChangePercent = this.calculatePercentChange(
      prior30d.avgContributorAgeDays,
      current30d.avgContributorAgeDays,
    );
    current30d.medianContributorAgeDaysChangePercent =
      this.calculatePercentChange(
        prior30d.medianContributorAgeDays,
        current30d.medianContributorAgeDays,
      );

    const result: DashboardData = {
      volumeMetrics: {
        current7d,
        prior7d,
        current30d,
        prior30d,
        weeklyTrends,
      },
      contributorAgeBuckets: this.buildContributorAgeBuckets(
        contributorAgeBucketsRaw,
      ),
    };

    const totalMs = performance.now() - overallStart;
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "debug",
        event: "dashboardTimings",
        repositoryId,
        totalMs: Number(totalMs.toFixed(3)),
        counts: {
          dailyMergeDays: dailyMerges.length,
          prTimingEntries: prTimingData.length,
          contributorAgeSamples,
        },
        timings: timings.map((timing) => ({
          label: timing.label,
          ms: Number(timing.ms.toFixed(3)),
        })),
      }),
    );

    return result;
  }

  private buildContributorAgeBuckets(
    rows: Array<{ bucket: string; count: number }>,
  ): ContributorAgeBucket[] {
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.bucket, row.count);
    }

    return AGE_BUCKETS.map((bucket) => ({
      key: bucket.key,
      title: bucket.title,
      range: bucket.range,
      count: counts.get(bucket.key) ?? 0,
    }));
  }

  private computeAverageAndMedian(values: number[]): {
    average: number | null;
    median: number | null;
  } {
    if (values.length === 0) {
      return { average: null, median: null };
    }

    const sum = values.reduce((total, value) => total + value, 0);
    const average = sum / values.length;

    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];

    return { average, median };
  }

  // TODO: If Temporal API becomes unavailable, consider using date-fns-tz:
  // import { utcToZonedTime } from 'date-fns-tz' and convert dates to America/New_York
  private aggregateToWeeklyTrends(
    dailyMerges: MergesByDay[],
    prTimingData: PrTiming[],
    weeks: number,
  ): WeeklyVolume[] {
    const weeklyMap = new Map<
      string,
      {
        prsMerged: number;
        totalLinesAdded: number;
        totalLinesDeleted: number;
        totalFilesChanged: number;
        totalFilesAdded: number;
        totalFilesModified: number;
        totalFilesRemoved: number;
        totalFilesRenamed: number;
        mergeTimesHours: number[];
        contributorAgeDays: number[];
        ageCounts: Map<string, number>;
      }
    >();
    const getWeekInfo = this.createWeekKeyMemoizer();
    const easternDateToWeekKey = new Map<string, string>();

    // Group daily data by Monday-based weeks using Eastern Time to ensure consistency
    for (const day of dailyMerges) {
      const { weekKey, easternDateKey } = getWeekInfo(day.merge_date);
      easternDateToWeekKey.set(easternDateKey, weekKey);
      if (!weeklyMap.has(weekKey)) {
        weeklyMap.set(weekKey, {
          prsMerged: 0,
          totalLinesAdded: 0,
          totalLinesDeleted: 0,
          totalFilesChanged: 0,
          totalFilesAdded: 0,
          totalFilesModified: 0,
          totalFilesRemoved: 0,
          totalFilesRenamed: 0,
          mergeTimesHours: [],
          contributorAgeDays: [],
          ageCounts: new Map(AGE_BUCKETS.map((b) => [b.title, 0])),
        });
      }

      const week = weeklyMap.get(weekKey)!;
      week.prsMerged += day.prs_merged;
      week.totalLinesAdded += day.total_lines_added;
      week.totalLinesDeleted += day.total_lines_deleted;
      week.totalFilesChanged += day.total_files_changed;
      week.totalFilesAdded += day.files_added;
      week.totalFilesModified += day.files_modified;
      week.totalFilesRemoved += day.files_removed;
      week.totalFilesRenamed += day.files_renamed;
      for (const age of day.contributor_ages ?? []) {
        week.contributorAgeDays.push(age);
        const bucketTitle = bucketAgeDays(age)?.title;
        if (!bucketTitle) continue;
        week.ageCounts.set(
          bucketTitle,
          (week.ageCounts.get(bucketTitle) ?? 0) + 1,
        );
      }
    }

    // Add timing data to the appropriate weeks using Eastern Time
    for (const prTiming of prTimingData) {
      const { weekKey, easternDateKey } = getWeekInfo(prTiming.merged_at);
      const trackedWeekKey =
        easternDateToWeekKey.get(easternDateKey) ?? weekKey;
      const week = weeklyMap.get(trackedWeekKey);
      if (week) {
        week.mergeTimesHours.push(prTiming.hours_to_merge);
      }
    }

    // Convert to WeeklyVolume array and sort by date
    const weeklyTrends: WeeklyVolume[] = Array.from(weeklyMap.entries())
      .map(([weekStartDate, data]) => {
        const mergeStats = this.computeAverageAndMedian(data.mergeTimesHours);
        const ageStats = this.computeAverageAndMedian(data.contributorAgeDays);

        return {
          weekStartDate,
          prsMerged: data.prsMerged,
          linesAdded: data.totalLinesAdded,
          linesDeleted: data.totalLinesDeleted,
          filesChanged: data.totalFilesChanged,
          filesAdded: data.totalFilesAdded,
          filesModified: data.totalFilesModified,
          filesRemoved: data.totalFilesRemoved,
          filesRenamed: data.totalFilesRenamed,
          ageBuckets: AGE_BUCKETS.map((bucket) => ({
            key: bucket.key,
            title: bucket.title,
            range: bucket.range,
            count: data.ageCounts.get(bucket.title) ?? 0,
          })),
          avgContributorAgeDays: ageStats.average,
          medianContributorAgeDays: ageStats.median,
          avgTimeToMergeHours: mergeStats.average,
          medianTimeToMergeHours: mergeStats.median,
        };
      })
      .sort((a, b) => a.weekStartDate.localeCompare(b.weekStartDate))
      .slice(-weeks);

    return weeklyTrends;
  }

  private createWeekKeyMemoizer(): (date: Date) => {
    weekKey: string;
    easternDateKey: string;
  } {
    const cache = new Map<
      string,
      {
        weekKey: string;
        easternDateKey: string;
      }
    >();

    return (date: Date) => {
      const easternDateKey = EASTERN_DATE_FORMATTER.format(date);
      const cached = cache.get(easternDateKey);
      if (cached) {
        return cached;
      }

      const plainDate = Temporal.PlainDate.from(easternDateKey);
      const daysFromMonday = (plainDate.dayOfWeek + 6) % 7;
      const monday = plainDate.subtract({ days: daysFromMonday });
      const computed = {
        weekKey: monday.toString(),
        easternDateKey,
      };
      cache.set(easternDateKey, computed);
      return computed;
    };
  }

  private calculatePeriodSnapshot(
    dailyMerges: MergesByDay[],
    prTimingData: PrTiming[],
    days: number,
    now: Date,
    offsetDays: number = 0,
  ): VolumeSnapshot {
    // Convert to Eastern Time for consistent boundaries
    const nowEastern = Temporal.Instant.fromEpochMilliseconds(
      now.getTime(),
    ).toZonedDateTimeISO(EASTERN_TIME_ZONE);

    const endDateEastern = nowEastern.subtract({ days: offsetDays });
    const startDateEastern = endDateEastern.subtract({ days });

    const startEpoch = startDateEastern.toInstant().epochMilliseconds;
    const endEpoch = endDateEastern.toInstant().epochMilliseconds;

    const totals = {
      prsMerged: 0,
      totalLinesAdded: 0,
      totalLinesDeleted: 0,
      totalFilesChanged: 0,
      totalFilesAdded: 0,
      totalFilesModified: 0,
      totalFilesRemoved: 0,
      totalFilesRenamed: 0,
    };
    const contributorAgeDays: number[] = [];

    for (const day of dailyMerges) {
      const mergeEpoch = day.merge_date.getTime();
      if (mergeEpoch < startEpoch) {
        continue;
      }
      if (mergeEpoch >= endEpoch) {
        break;
      }

      totals.prsMerged += day.prs_merged;
      totals.totalLinesAdded += day.total_lines_added;
      totals.totalLinesDeleted += day.total_lines_deleted;
      totals.totalFilesChanged += day.total_files_changed;
      totals.totalFilesAdded += day.files_added;
      totals.totalFilesModified += day.files_modified;
      totals.totalFilesRemoved += day.files_removed;
      totals.totalFilesRenamed += day.files_renamed;
      if (day.contributor_ages?.length) {
        contributorAgeDays.push(...day.contributor_ages);
      }
    }

    let avgTimeToMergeHours: number | null = null;
    let medianTimeToMergeHours: number | null = null;

    const mergeHours: number[] = [];
    let mergeHoursSum = 0;

    for (const pr of prTimingData) {
      const mergedEpoch = pr.merged_at.getTime();
      if (mergedEpoch < startEpoch) {
        continue;
      }
      if (mergedEpoch >= endEpoch) {
        break;
      }

      mergeHours.push(pr.hours_to_merge);
      mergeHoursSum += pr.hours_to_merge;
    }

    if (mergeHours.length > 0) {
      avgTimeToMergeHours = mergeHoursSum / mergeHours.length;

      const sortedTimes = mergeHours.slice().sort((a, b) => a - b);
      const mid = Math.floor(sortedTimes.length / 2);
      if (sortedTimes.length % 2 === 0) {
        medianTimeToMergeHours = (sortedTimes[mid - 1] + sortedTimes[mid]) / 2;
      } else {
        medianTimeToMergeHours = sortedTimes[mid];
      }
    }

    const ageStats = this.computeAverageAndMedian(contributorAgeDays);

    return {
      prsMerged: totals.prsMerged,
      prsMergedChangePercent: null, // Will be calculated later
      linesAdded: totals.totalLinesAdded,
      linesAddedChangePercent: null,
      linesDeleted: totals.totalLinesDeleted,
      linesDeletedChangePercent: null,
      filesChanged: totals.totalFilesChanged,
      filesChangedChangePercent: null,
      filesAdded: totals.totalFilesAdded,
      filesModified: totals.totalFilesModified,
      filesRemoved: totals.totalFilesRemoved,
      filesRenamed: totals.totalFilesRenamed,
      avgContributorAgeDays: ageStats.average,
      avgContributorAgeDaysChangePercent: null,
      medianContributorAgeDays: ageStats.median,
      medianContributorAgeDaysChangePercent: null,
      avgTimeToMergeHours,
      avgTimeToMergeHoursChangePercent: null, // Will be calculated later
      medianTimeToMergeHours,
      medianTimeToMergeHoursChangePercent: null, // Will be calculated later
    };
  }

  async getRepositoryOverview(
    repositoryId: number,
  ): Promise<RepositoryOverview | null> {
    // Fetch overview data and repository metadata together to avoid waterfall latency
    const [dbData, repositories] = await Promise.all([
      this.repository.getRepositoryOverview(repositoryId),
      this.repository.getRepositoryDetails(),
    ]);

    if (!dbData) {
      return null;
    }

    // Get repository metadata to bundle with overview
    const repositoryMetadata = repositories.find(
      (repo) => repo.repository_id === repositoryId,
    );

    if (!repositoryMetadata) {
      throw new Error(`Repository ${repositoryId} not found`);
    }

    return transformRepositoryOverview(dbData, {
      org: repositoryMetadata.org,
      name: repositoryMetadata.name,
    });
  }

  private calculatePercentChange(
    oldValue: number | null,
    newValue: number | null,
  ): number | null {
    if (oldValue === null || newValue === null) {
      return null; // Can't calculate % change with null values
    }
    if (oldValue === 0) {
      return newValue === 0 ? 0 : null; // Can't calculate % change from zero
    }
    return Math.round(((newValue - oldValue) / oldValue) * 100);
  }
}
