import {
  GithubArchiveError,
  type GithubArchive,
} from "../features/githubArchive/githubArchiveTypes.ts";
import { IRepository, PostgresRepository } from "../repository/repository.ts";
import { GhApi } from "../api/ghApi.ts";
import { FileSystemService } from "../services/fileSystemService.ts";
import { RateExceededError } from "../models/errors/RateExceededError.ts";
import { GithubUserFetchError } from "../models/errors/GithubUserFetchError.ts";
import { Stopwatch } from "../util/stopwatch.ts";
import { computePullRequestEnhancedStats } from "./pullRequestEnhancedStats.ts";
import { HydratedIssue } from "../models/gh/issue.ts";
import { State } from "../models/gh/state.ts";
import { NotFound } from "../models/errors/notFound.ts";
import { IssueType } from "../models/gh/issueType.ts";
import { UNKNOWN_USER } from "../models/gh/user.ts";
import { IssueMoved } from "../models/errors/IssueMoved.ts";
import { IssueDeleted } from "../models/errors/IssueDeleted.ts";
import { ProblematicIssueType } from "../models/ProblematicIssueType.ts";
import { ComputedUserMetricsRepository } from "../repository/computedUserMetricsRepository.ts";
import { RELATIONSHIP_PERIODS } from "../repository/userRelationshipRepository.ts";
import { UserRelationshipService } from "../services/userRelationshipService.ts";
import { toGithubUserProfileSnapshot } from "../util/githubUserProfile.ts";
import prettyMilliseconds from "pretty-ms";
import { PostgresTeamRepository } from "../repository/postgresTeamRepository.ts";
import { TrendsRepository } from "../features/trends/trendsRepository.ts";
import { RepositoryContributorsRepository } from "../features/repositoryContributors/repositoryContributorsRepository.ts";

export type BackfillLogLevel = "info" | "error";

export interface BackfillLogEvent {
  level: BackfillLogLevel;
  message: string;
  timestamp: string;
}

export interface BackfillProgress {
  requestedCount: number;
  processedCount: number;
  hitRateLimit: boolean;
  nextStartIssueNumber: number | null;
}

// Simple hook for streaming log output today. We can extend this to
// structured metrics (remaining API quota, etc.) without changing callers.
export interface BackfillerOptions {
  archive?: GithubArchive;
  silent?: boolean;
  onLog?: (event: BackfillLogEvent) => void;
  computedUserMetricsRepository?: ComputedUserMetricsRepository;
  userRelationshipService?: UserRelationshipService;
  teamRepository?: PostgresTeamRepository;
  trendsRepository?: TrendsRepository;
  repositoryContributorsRepository?: RepositoryContributorsRepository;
}

export class Backfiller {
  private api: GhApi;
  private repo: IRepository;
  private fileSystemService?: FileSystemService;
  private computedUserMetricsRepository?: ComputedUserMetricsRepository;
  private userRelationshipService?: UserRelationshipService;
  private teamRepository?: PostgresTeamRepository;
  private trendsRepository?: TrendsRepository;
  private repositoryContributorsRepository?: RepositoryContributorsRepository;
  private archive?: GithubArchive;
  private silent = false;
  private logListener?: (event: BackfillLogEvent) => void;

  constructor(ghApi: GhApi, repo: IRepository, options?: BackfillerOptions) {
    this.api = ghApi;
    this.repo = repo;
    this.archive = options?.archive;
    this.silent = options?.silent ?? false;
    this.logListener = options?.onLog;
    this.computedUserMetricsRepository = options?.computedUserMetricsRepository;
    this.userRelationshipService = options?.userRelationshipService;
    this.teamRepository = options?.teamRepository;
    this.trendsRepository = options?.trendsRepository;
    this.repositoryContributorsRepository =
      options?.repositoryContributorsRepository;

    // Always create FileSystemService - persistence will only work for PostgreSQL
    // NOTE: Cache and fallback computation disabled for testing database performance
    this.fileSystemService = new FileSystemService(repo, {
      log: (...args: unknown[]) => this.log(...args),
      warn: (...args: unknown[]) => this.log(...args),
      error: (...args: unknown[]) => this.logError(...args),
    });

    if (
      repo instanceof PostgresRepository &&
      !this.computedUserMetricsRepository
    ) {
      throw new Error(
        "ComputedUserMetricsRepository must be provided for PostgreSQL backfills",
      );
    }

    if (repo instanceof PostgresRepository && !this.trendsRepository) {
      throw new Error(
        "TrendsRepository must be provided for PostgreSQL backfills",
      );
    }
  }

  private log(...args: unknown[]): void {
    if (!this.silent) {
      console.log(...args);
    }
    this.emitLog("info", args);
  }

  private logError(...args: unknown[]): void {
    if (!this.silent) {
      console.error(...args);
    }
    this.emitLog("error", args);
  }

  private printStopwatch(stopWatch: Stopwatch, name: string): void {
    stopWatch.print(
      name,
      (...args: unknown[]) => this.log(...args),
      (durationMs) => this.formatDuration(durationMs),
    );
  }

  private formatDuration(durationMs: number): string {
    return prettyMilliseconds(durationMs);
  }

  private async timeOperation<T>(
    label: string,
    operation: () => Promise<T>,
    timings: Map<string, number>,
  ): Promise<T> {
    const start = Date.now();
    const result = await operation();
    const duration = Date.now() - start;
    timings.set(label, duration);
    this.log(`${label} completed in ${this.formatDuration(duration)}`);
    return result;
  }

  private printTimingSummary(
    name: string,
    startedAt: number,
    timings: Map<string, number>,
  ): void {
    const totalElapsed = Date.now() - startedAt;
    const entries = [...timings.entries(), ["Total", totalElapsed] as const];

    let longestKeyLength = 0;
    for (const [key] of entries) {
      if (key.length > longestKeyLength) {
        longestKeyLength = key.length;
      }
    }

    const spacesBetween = longestKeyLength + 4;
    const lines: string[] = [];
    lines.push(`${name}:`);
    for (const [key, value] of entries) {
      const msg = `  ${key}${" ".repeat(spacesBetween - key.length)}${this.formatDuration(
        value,
      )}`;
      lines.push(msg);
    }

    this.log(lines.join("\n"));
  }

  private emitLog(level: BackfillLogLevel, args: unknown[]): void {
    if (!this.logListener) {
      return;
    }

    try {
      const message = this.formatLogArgs(args);
      this.logListener({
        level,
        message,
        timestamp: new Date().toISOString(),
      });
    } catch (listenerError) {
      console.error("Backfiller log listener error", listenerError);
    }
  }

  private formatLogArgs(args: unknown[]): string {
    return args
      .map((arg) => {
        if (typeof arg === "string") {
          return arg;
        }

        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join(" ");
  }

  private async runPostProcessing(
    timingSummary: Map<string, number>,
  ): Promise<void> {
    if (!(this.repo instanceof PostgresRepository)) {
      return;
    }

    const postgresRepo = this.repo;
    const repoId = await postgresRepo.getRepositoryId(
      this.api.owner,
      this.api.repo,
    );
    const parallelTasks: Promise<unknown>[] = [
      this.timeOperation(
        "Repository overview",
        () => postgresRepo.updateRepositoryOverview(repoId),
        timingSummary,
      ),
    ];

    if (this.computedUserMetricsRepository) {
      parallelTasks.push(
        this.timeOperation(
          "Computed user metrics",
          () =>
            this.computedUserMetricsRepository!.recomputeAllMetricsForRepository(
              repoId,
            ),
          timingSummary,
        ),
      );

      parallelTasks.push(
        this.timeOperation(
          "Computed pull request metrics",
          () =>
            this.computedUserMetricsRepository!.recomputePullRequestMetricsForRepository(
              repoId,
            ),
          timingSummary,
        ),
      );
    }

    if (this.fileSystemService) {
      parallelTasks.push(
        this.timeOperation(
          "Filesystem persistence",
          () => this.fileSystemService!.computeAndStore(repoId),
          timingSummary,
        ),
      );
    }

    if (this.userRelationshipService) {
      parallelTasks.push(
        this.timeOperation(
          "User relationships",
          async () => {
            for (const period of RELATIONSHIP_PERIODS) {
              await this.userRelationshipService!.recomputeForRepository(
                repoId,
                period,
              );
            }
          },
          timingSummary,
        ),
      );
    }

    parallelTasks.push(
      this.timeOperation(
        "Trends monthly",
        () => this.trendsRepository!.recomputeMonthlyForRepository(repoId),
        timingSummary,
      ),
    );

    if (this.repositoryContributorsRepository) {
      parallelTasks.push(
        this.timeOperation(
          "Repository contributors",
          () =>
            this.repositoryContributorsRepository!.recomputeForRepository(
              repoId,
            ),
          timingSummary,
        ),
      );
    }

    await Promise.all(parallelTasks);
  }

  private async withArchiveUploads<T>(operation: () => Promise<T>): Promise<T> {
    let outcome: { ok: true; value: T } | { ok: false; error: unknown };
    try {
      outcome = { ok: true, value: await operation() };
    } catch (error) {
      outcome = { ok: false, error };
    }

    // Finalize on success or failure, without replacing an original sync error.
    if (this.archive) {
      const uploadStartedAt = Date.now();
      try {
        const uploaded = await this.archive.uploadPending();
        if (uploaded > 0)
          this.log(
            `Uploaded ${uploaded} GitHub archives to S3/R2 in ${this.formatDuration(Date.now() - uploadStartedAt)}`,
          );
      } catch (error) {
        this.logError(
          `${outcome.ok ? "Sync processing completed; " : ""}GitHub archive upload failed after ${this.formatDuration(Date.now() - uploadStartedAt)}; pending files retained`,
          error,
        );
        if (outcome.ok) throw error;
      }
    }
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  }

  async forUsers(...users: string[]) {
    return this.withArchiveUploads(() => this.forUsersInternal(users));
  }

  private async forUsersInternal(users: string[]) {
    const startingLimit = await this.printRateLimit();
    for (const user of users) {
      const pullRequestNumbersByUser = (await this.getPrsToProcess(user)).slice(
        0,
        5,
      );
      this.log(
        "Processing user " +
          user +
          " with " +
          pullRequestNumbersByUser.length +
          " PRs",
      );
      for (let i = 0; i < pullRequestNumbersByUser.length; i++) {
        await this.processIssue(pullRequestNumbersByUser[i]);
        if (i % 10 === 0 && i > 0) {
          this.log(
            "Processed PRs " + i + "/" + pullRequestNumbersByUser.length,
          );
        }
      }
    }

    const endLimit = await this.printRateLimit();
    this.log("Rate limit used: " + (startingLimit - endLimit));
    //  this.repo.close();
  }

  async backfillFromLatest(maxRecordsToProcess: number) {
    await this.backfillFromLatestInternal(maxRecordsToProcess, {
      skipOpenNonPullRequests: false,
    });
  }

  async backfillFromLatestPullRequests(maxRecordsToProcess: number) {
    await this.backfillFromLatestInternal(maxRecordsToProcess, {
      skipOpenNonPullRequests: true,
    });
  }

  async backfillFromLatestPullRequestsWithResult(
    maxRecordsToProcess: number,
  ): Promise<BackfillProgress> {
    return await this.backfillFromLatestInternal(maxRecordsToProcess, {
      skipOpenNonPullRequests: true,
    });
  }

  async backfillFromLatestPullRequestsStartingAt(
    startIssueNumber: number,
    maxRecordsToProcess: number,
  ): Promise<BackfillProgress> {
    return await this.backfillFromLatestInternal(maxRecordsToProcess, {
      skipOpenNonPullRequests: true,
      startIssueNumber,
    });
  }

  private async backfillFromLatestInternal(
    maxRecordsToProcess: number,
    options: { skipOpenNonPullRequests: boolean; startIssueNumber?: number },
  ): Promise<BackfillProgress> {
    return this.withArchiveUploads(() =>
      this.backfillFromLatestRun(maxRecordsToProcess, options),
    );
  }

  private async backfillFromLatestRun(
    maxRecordsToProcess: number,
    options: { skipOpenNonPullRequests: boolean; startIssueNumber?: number },
  ): Promise<BackfillProgress> {
    const startingLimit = await this.printRateLimit();
    const latestIssue =
      options.startIssueNumber ?? (await this.api.getMostRecentIssue());
    const closedIssues = await this.repo.getClosedIssues();
    const processed = new Set<number>(closedIssues);

    if (options.skipOpenNonPullRequests) {
      const openNonPullRequests = await this.repo.getOpenNonPullRequestIssues();
      for (const issueId of openNonPullRequests) {
        processed.add(issueId);
      }
    }

    let recordsProcessed = 0;
    let hitRateLimit = false;
    let nextStartIssueNumber: number | null = null;
    const skippedIssues: number[] = [];
    for (let i = latestIssue; i > 0; i--) {
      if (processed.has(i)) {
        skippedIssues.push(i);
        continue;
      }
      this.printSkippedIssues(skippedIssues);
      if (recordsProcessed >= maxRecordsToProcess) {
        break;
      }
      try {
        await this.processIssue(i);
        recordsProcessed++;
      } catch (e) {
        if (e instanceof GithubArchiveError) throw e;
        if (e instanceof RateExceededError) {
          hitRateLimit = true;
          nextStartIssueNumber = i;
          this.logError("Aborting: " + e.message);
        } else {
          this.log("Unknown error for issue " + i, e);
        }
        break;
      }
    }
    this.printSkippedIssues(skippedIssues);

    const timingStart = Date.now();
    const timingSummary = new Map<string, number>();
    await this.timeOperation(
      "User activity update",
      () => this.repo.updateUserActivity(),
      timingSummary,
    );
    await this.runPostProcessing(timingSummary);

    // Print consolidated timing summary
    this.printTimingSummary("Total Processing", timingStart, timingSummary);

    //  this.repo.close();
    const endLimit = await this.printRateLimit();
    this.log("Rate limit used: " + (startingLimit - endLimit));
    this.log(
      `Records processed: ${recordsProcessed} Skipped: ${skippedIssues.length}`,
    );

    return {
      requestedCount: maxRecordsToProcess,
      processedCount: recordsProcessed,
      hitRateLimit,
      nextStartIssueNumber,
    };
  }

  async backfillFromLastProcessed(maxRecordsToProcess: number) {
    return this.withArchiveUploads(() =>
      this.backfillFromLastProcessedInternal(maxRecordsToProcess),
    );
  }

  private async backfillFromLastProcessedInternal(maxRecordsToProcess: number) {
    const startingLimit = await this.printRateLimit();

    const lastProcessedIssue = await this.repo.getLowestIssueId();

    let recordsProcessed = 0;
    for (let i = lastProcessedIssue - 1; i > 0; i--) {
      if (recordsProcessed >= maxRecordsToProcess) {
        break;
      }
      try {
        await this.processIssue(i);
        recordsProcessed++;
      } catch (e) {
        if (e instanceof GithubArchiveError) throw e;
        if (e instanceof RateExceededError) {
          this.logError("Aborting: " + e.message);
        } else {
          this.log("Unknown error for issue " + i, e);
        }
        break;
      }
    }

    const timingStart = Date.now();
    const timingSummary = new Map<string, number>();
    await this.timeOperation(
      "User activity update",
      () => this.repo.updateUserActivity(),
      timingSummary,
    );
    await this.runPostProcessing(timingSummary);

    // Print consolidated timing summary
    this.printTimingSummary("Total Processing", timingStart, timingSummary);

    const endLimit = await this.printRateLimit();
    this.log("Rate limit used: " + (startingLimit - endLimit));
    this.log(`Records processed: ${recordsProcessed}`);
  }

  private printSkippedIssues(skippedIssues: number[]): void {
    if (skippedIssues.length == 0) {
      return;
    }
    if (skippedIssues.length == 1) {
      this.log(`Skipped issue ${skippedIssues[0]} \n`);
      skippedIssues.length = 0;
      return;
    }
    this.log(
      `Skipped issues: ${skippedIssues[0]} - ${
        skippedIssues[skippedIssues.length - 1]
      } (${skippedIssues.length}) \n`,
    );

    skippedIssues.length = 0;
  }

  private async processIssue(num: number) {
    let issue: HydratedIssue;
    const fetchedAt = new Date().toISOString();
    const stopWatch = new Stopwatch();
    try {
      stopWatch.start("Fetch");
      issue = await this.api.getFullIssue(num);
    } catch (e) {
      if (e instanceof NotFound) {
        issue = this.buildProblematicIssue(ProblematicIssueType.NOT_FOUND, num);
        this.log("Could not find issue for " + num + " assuming discussion");
      } else if (e instanceof IssueMoved) {
        issue = this.buildProblematicIssue(ProblematicIssueType.MOVED, num);
        this.log(e.message);
      } else if (e instanceof IssueDeleted) {
        issue = this.buildProblematicIssue(ProblematicIssueType.DELETED, num);
        this.log(e.message);
      } else {
        throw e;
      }
    }
    try {
      stopWatch.start("Insert (" + issue.state + ")");
      const enhancedStats = computePullRequestEnhancedStats(issue);
      await this.repo.insertIssue(issue, enhancedStats);
    } catch (e) {
      this.log("Error inserting issue " + num, e);
      return; // No capture unless insertIssue's transaction committed.
    }

    if (
      this.archive &&
      (issue.type === IssueType.ISSUE ||
        (issue.type === IssueType.PULL_REQUEST && issue.state === State.CLOSED))
    ) {
      stopWatch.start("Archive (disk)");
      await this.archive.save({
        number: issue.number,
        type: issue.type === IssueType.PULL_REQUEST ? "pull_request" : "issue",
        fetchedAt,
        responses: this.api.getEndpointResponses()[num] ?? [],
      });
    }

    const options: Intl.DateTimeFormatOptions = {
      month: "2-digit",
      day: "2-digit",
      year: "2-digit",
    };
    const prettyDate = issue.created_at.toLocaleDateString("en-US", options);
    this.printStopwatch(stopWatch, `Issue ${num} (${prettyDate})`);
    this.log();
  }

  private async getPrsToProcess(userName: string): Promise<number[]> {
    const allPrsForUser = await this.api.getPullRequestNumbersByUser(userName);
    const allPrsSet = new Set(allPrsForUser);

    const processedPrs = await this.repo.getAllProcessedPullRequests(userName);
    processedPrs.forEach((processedPr) => allPrsSet.delete(processedPr));

    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - 1);
    const openPrsToSkip = await this.repo.getOpenPullRequestsToSkip(
      userName,
      daysAgo,
    );
    openPrsToSkip.forEach((openPr) => allPrsSet.delete(openPr));
    return Array.from(allPrsSet);
  }

  private async printRateLimit(): Promise<number> {
    const rateLimit = await this.api.getRateLimit();
    const resetTime = new Date(rateLimit.rate.reset * 1000);
    const timeLeft = resetTime.getTime() - new Date().getTime();
    this.log(
      "Remaining API calls: " + rateLimit.rate.remaining,
      " Reset: " + resetTime.toLocaleTimeString(),
      ` (${this.formatDuration(Math.max(0, timeLeft))})`,
    );
    return rateLimit.rate.remaining;
  }

  /**
   * Sync GitHub profile snapshots for users that are missing one, still
   * carrying a legacy avatar-only row, or older than the cutoff.
   * No post-processing hooks are triggered.
   */
  async syncGithubProfiles(profileCutoffDate: Date): Promise<void> {
    if (!(this.repo instanceof PostgresRepository)) {
      this.logError("GitHub profile sync requires PostgreSQL");
      return;
    }

    const pgRepo = this.repo as PostgresRepository;
    const usersNeedingProfile =
      await pgRepo.getUsersNeedingProfileSync(profileCutoffDate);

    await this.syncGithubProfileUsers(
      pgRepo,
      usersNeedingProfile,
      "All users already have GitHub profiles synced after the cutoff",
    );
  }

  async syncUnsyncedGithubProfiles(): Promise<void> {
    if (!(this.repo instanceof PostgresRepository)) {
      this.logError("GitHub profile sync requires PostgreSQL");
      return;
    }

    const pgRepo = this.repo as PostgresRepository;
    const usersNeedingProfile = await pgRepo.getUsersMissingProfileSync();

    await this.syncGithubProfileUsers(
      pgRepo,
      usersNeedingProfile,
      "All users already have GitHub profiles synced",
    );
  }

  private async syncGithubProfileUsers(
    pgRepo: PostgresRepository,
    usersNeedingProfile: Array<{ user_id: number; gh_login: string }>,
    emptyMessage: string,
  ): Promise<void> {
    if (usersNeedingProfile.length === 0) {
      this.log(emptyMessage);
      return;
    }

    this.log(
      `Found ${usersNeedingProfile.length} users needing GitHub profile sync`,
    );

    const startingLimit = await this.printRateLimit();
    let synced = 0;
    let notFound = 0;
    let failed = 0;

    for (const user of usersNeedingProfile) {
      try {
        const profile = await this.api.getUserProfile(user.gh_login);
        await pgRepo.upsertUserProfile(
          user.user_id,
          toGithubUserProfileSnapshot(profile),
        );
        synced++;

        if (synced % 10 === 0 || synced === usersNeedingProfile.length) {
          this.log(`Synced ${synced}/${usersNeedingProfile.length} profiles`);
        }
      } catch (error) {
        if (error instanceof RateExceededError) {
          this.logError(
            `Rate limit exceeded after syncing ${synced} profiles. Stopping.`,
          );
          break;
        }

        if (error instanceof GithubUserFetchError && error.status === 404) {
          // User no longer exists on GitHub — store a null avatar so we
          // don't retry them on every sync.
          notFound++;
          await pgRepo.upsertUserProfile(user.user_id, {
            avatar_url: null,
            name: null,
            company: null,
            location: null,
            email: null,
            github_created_at: null,
          });
          continue;
        }

        failed++;
        const msg = error instanceof Error ? error.message : String(error);
        this.logError(`Failed to fetch profile for ${user.gh_login}: ${msg}`);
      }
    }

    const endLimit = await this.printRateLimit();
    const parts = [`${synced} synced`];
    if (notFound > 0) parts.push(`${notFound} not found on GitHub`);
    if (failed > 0) parts.push(`${failed} failed`);
    this.log(
      `GitHub profile sync complete: ${parts.join(", ")}, ${
        startingLimit - endLimit
      } API calls used`,
    );
  }

  async syncGithubTeams(): Promise<void> {
    if (!(this.repo instanceof PostgresRepository)) {
      this.logError("GitHub team sync requires PostgreSQL");
      return;
    }

    if (!this.teamRepository) {
      this.logError("GitHub team sync requires a team repository");
      return;
    }

    const pgRepo = this.repo as PostgresRepository;
    const repositoryId = await pgRepo.getRepositoryId(
      this.api.owner,
      this.api.repo,
    );
    const orgTeams = await this.api.getOrgTeams(this.api.owner);

    if (orgTeams.length === 0) {
      this.log(`No GitHub teams found for org ${this.api.owner}`);
      return;
    }

    this.log(`Found ${orgTeams.length} GitHub teams for org ${this.api.owner}`);

    let relevantCount = 0;
    for (const team of orgTeams) {
      const hasRepoAccess = await this.api.teamHasRepositoryAccess(
        this.api.owner,
        team.slug,
        this.api.owner,
        this.api.repo,
      );
      if (!hasRepoAccess) {
        continue;
      }

      relevantCount++;
      this.log(`Syncing team ${team.slug}`);
      const storedTeam = await this.teamRepository.upsertGithubTeam({
        repositoryId,
        name: team.name,
        slug: team.slug,
        ghTeamId: team.id,
        ghOrgLogin: this.api.owner,
      });

      const members = await this.api.getTeamMembers(this.api.owner, team.slug);
      const userMap = await pgRepo.getOrCreateUsers(members);
      await this.teamRepository.replaceGithubTeamMembers(
        repositoryId,
        storedTeam.teamId,
        members.map((member) => ({
          userId: userMap.get(member.id)!,
          role: "member",
        })),
      );
      this.log(`Synced ${members.length} members for team ${team.slug}`);
    }

    this.log(
      `GitHub team sync complete: ${relevantCount} repository teams synced`,
    );
  }

  private buildProblematicIssue(
    issueType: ProblematicIssueType,
    num: number,
  ): HydratedIssue {
    let msg = "ERROR HANDLING PROBLEMATIC ISSUE";
    let issueTypeId = IssueType.UNKNOWN;
    switch (issueType) {
      case ProblematicIssueType.NOT_FOUND:
        msg = "Not Found";
        issueTypeId = IssueType.NOT_FOUND;
        break;
      case ProblematicIssueType.MOVED:
        msg = "Issue has been moved";
        issueTypeId = IssueType.MOVED;
        break;
      case ProblematicIssueType.DELETED:
        msg = "Issue has been deleted";
        issueTypeId = IssueType.DELETED;
        break;
    }
    return {
      number: num,
      title: msg,
      body: msg,
      state: State.CLOSED,
      created_at: new Date(0),
      updated_at: new Date(0),
      closed_at: new Date(0),
      user: UNKNOWN_USER,
      type: issueTypeId,
      hydrated_pull_request: undefined,
    };
  }
}
