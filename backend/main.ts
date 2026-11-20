import { githubArchiveFromEnv } from "./features/githubArchive/githubArchiveService.ts";
import { timingSafeEqual } from "node:crypto";
import process, { env } from "node:process";
import { runSyncCron } from "./cron/syncCron.ts";
import { appendFile } from "node:fs/promises";
import { once } from "node:events";
import { createHttpServer } from "./httpServer.ts";
import { Context, Hono, Next } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { GhApi } from "./api/ghApi.ts";
import { IRepository, PostgresRepository } from "./repository/repository.ts";
import {
  createReportSqlClient,
  createSqlClient,
  getSharedSqlClient,
  SqlClient,
} from "./repository/sqlClient.ts";
import { ComputedUserMetricsRepository } from "./repository/computedUserMetricsRepository.ts";
import { PostgresComputedUserMetricsRepository } from "./repository/postgresComputedUserMetricsRepository.ts";
import {
  RELATIONSHIP_PERIOD,
  RELATIONSHIP_PERIODS,
  UserRelationshipRepository,
} from "./repository/userRelationshipRepository.ts";
import { PostgresUserRelationshipRepository } from "./repository/postgresUserRelationshipRepository.ts";
import { UserRelationshipService } from "./services/userRelationshipService.ts";
import { Service } from "./service.ts";
import { TrendsRepository } from "./features/trends/trendsRepository.ts";
import { registerTrendsRoutes } from "./features/trends/trendsRoutes.ts";
import { registerReportsRoutes } from "./features/reports/reportsRoutes.ts";
import { ReportsRepository } from "./features/reports/reportsRepository.ts";
import { ReportsService } from "./features/reports/reportsService.ts";
import { TrendsService } from "./features/trends/trendsService.ts";
import { RepositoryContributorsRepository } from "./features/repositoryContributors/repositoryContributorsRepository.ts";
import { registerRepositoryContributorsRoutes } from "./features/repositoryContributors/repositoryContributorsRoutes.ts";
import { RepositoryContributorsService } from "./features/repositoryContributors/repositoryContributorsService.ts";
import { registerAgentContextRoutes } from "./features/agentContext/agentContextRoutes.ts";
import { AgentContextService } from "./features/agentContext/agentContextService.ts";
import { cors } from "hono/cors";
import { loadEnv } from "./util/loadEnv.ts";
import { isTransientDatabaseConnectionError } from "./util/isTransientDatabaseConnectionError.ts";
import { sleep } from "./util/sleep.ts";
import {
  Backfiller,
  type BackfillerOptions,
  type BackfillLogEvent,
} from "./backfill/backfiller.ts";
import { AuthenticationService } from "./authenticationService.ts";
import type { AuthenticationResult } from "./services/authenticationIdentityService.ts";
import { AuthorizationService } from "./authorizationService.ts";
import {
  createAuthAndAuthzMiddleware,
  createAuthMiddleware,
} from "./middleware.ts";
import { createDebugSleepMiddleware } from "./middleware/debugSleep.ts";
import { getRequestIp, getRequestUserAgent } from "./requestIp.ts";
import { RepositoryService } from "./services/repositoryService.ts";
import { RepositoryRepository } from "./repository/repositoryRepository.ts";
import { GithubUserFetchError } from "./models/errors/GithubUserFetchError.ts";
import { RateExceededError } from "./models/errors/RateExceededError.ts";
import { PostgresAuthRepository } from "./repository/postgresAuthRepository.ts";
import { GithubLoginRepository } from "./features/githubLogin/githubLoginRepository.ts";
import {
  getGithubLoginConfig,
  GithubLoginService,
} from "./features/githubLogin/githubLoginService.ts";
import { createGithubLoginRoutes } from "./features/githubLogin/githubLoginRoutes.ts";
import { createGithubConnectionsRoutes } from "./features/githubConnections/githubConnectionsRoutes.ts";
import { GithubConnectionsService } from "./features/githubConnections/githubConnectionsService.ts";
import {
  ConnectionError,
  GithubConnectionsRepository,
} from "./features/githubConnections/githubConnectionsRepository.ts";
import type { GithubCredentialsProvider } from "./models/githubCredentials.ts";
import { resolveGithubSyncCredentials } from "./features/sync/githubSyncCredentials.ts";
import { AuthenticationIdentityService } from "./services/authenticationIdentityService.ts";
import { AuthUser } from "./models/auth.ts";
import { PostgresWorkspaceRepository } from "./repository/postgresWorkspaceRepository.ts";
import { IWorkspaceRepository } from "./repository/workspaceRepository.ts";
import { PostgresTeamRepository } from "./features/teams/teamsRepository.ts";
import { registerTeamsRoutes } from "./features/teams/teamsRoutes.ts";
import { TeamsService } from "./features/teams/teamsService.ts";
import {
  captureException as captureSentryException,
  flushSentry,
  initSentry,
  isSentryConfigured,
} from "./sentry.ts";
import {
  encodeRepositoryId,
  isLegacyNumericRepositoryRef,
  resolveRepositoryRef,
} from "./repositoryPublicId.ts";

// Load environment variables from .env file
await loadEnv();
initSentry();

const processStartedAt = Date.now();

const ROBOTS_TXT = `User-agent: *
Disallow: /
`;

let suppressExpectedStartupDbErrorsUntil = 0;
let authService: AuthenticationService;

function logUserEndpointError(
  route: string,
  repositoryId: number | null,
  userName: string,
  error: unknown,
) {
  console.error(`[${route}] repo=${repositoryId} user=${userName}`, error);
}

function isStartupConnectionError(error: unknown): boolean {
  return isTransientDatabaseConnectionError(error);
}

function shouldSuppressExpectedStartupDbError(error: unknown): boolean {
  return (
    Date.now() < suppressExpectedStartupDbErrorsUntil &&
    isStartupConnectionError(error)
  );
}

function suppressExpectedStartupDbErrorsFor(durationMs: number): void {
  suppressExpectedStartupDbErrorsUntil = Math.max(
    suppressExpectedStartupDbErrorsUntil,
    Date.now() + durationMs,
  );
}

function clearExpectedStartupDbErrorSuppression(): void {
  suppressExpectedStartupDbErrorsUntil = 0;
}

function shouldWriteRequestLogFile(): boolean {
  if (env.REQUEST_LOG_FILE === "false") {
    return false;
  }

  return !env.RAILWAY_ENVIRONMENT && !env.RAILWAY_SERVICE_NAME && !env.VERCEL;
}

async function appendRequestLogFile(message: string): Promise<void> {
  if (!shouldWriteRequestLogFile()) {
    return;
  }

  try {
    await appendFile("request_log.txt", message, "utf8");
  } catch (error) {
    console.warn("Unable to write request_log.txt:", error);
  }
}

const app = new Hono();

app.use(
  "*",
  createDebugSleepMiddleware(() => authService),
);

app.get("/healthz", (c: Context) => {
  return c.json({
    status: "ok",
    uptime_seconds: Math.round((Date.now() - processStartedAt) / 1000),
  });
});

app.get("/robots.txt", (c: Context) => {
  c.header("Cache-Control", "public, max-age=86400");
  return c.text(ROBOTS_TXT);
});

app.onError((err, c) => {
  console.error("Hono onError:", err);
  captureSentryException(err, {
    tags: { source: "hono_onError" },
    extra: {
      method: c.req.method,
      url: c.req.url,
    },
  });
  return c.json({ error: "Internal server error" }, 500);
});

// Simple URL cache: url -> json response
const urlCache = new Map<string, unknown>();

// Cache middleware - runs after auth
const cacheMiddleware = async (c: Context, next: Next) => {
  const url = new URL(c.req.url);

  // Skip caching for filesystem tree endpoints - they have their own caching
  if (
    url.pathname.includes("/api/filesystem/") &&
    url.pathname.endsWith("/tree")
  ) {
    await next();
    return;
  }

  const authUser = c.get("user") as AuthUser | undefined;
  const cacheKey = authUser ? `${authUser.userId}:${c.req.url}` : c.req.url;
  const cached = urlCache.get(cacheKey);
  if (cached) {
    return c.json(cached);
  }

  await next();

  // Cache the response if it's JSON and successful
  if (
    c.res.status === 200 &&
    c.res.headers.get("content-type")?.includes("application/json")
  ) {
    try {
      const response = await c.res.clone().json();
      urlCache.set(cacheKey, response);
    } catch {
      // Ignore caching errors
    }
  }
};
await appendRequestLogFile(
  `\n--- Server Restarted at ${new Date().toISOString()} ---\n`,
);
console.log(`[${new Date().toISOString()}] Server starting...`);

// The logging middleware
app.use("*", async (c: Context, next: Next) => {
  const start = performance.now();

  try {
    await next();
  } catch (error) {
    console.error("Uncaught exception:", error);

    const url = new URL(c.req.url);
    const requestTarget = `${url.pathname}${url.search}`;
    const ip = getRequestIp(c.req.raw.headers, c.env?.REMOTE_ADDR);
    const authUser = c.get("user") as AuthUser | undefined;

    let errorDetails = {
      name: "UnknownError",
      message: "An unexpected error occurred.",
      stack: "No stack trace available.",
    };

    if (error instanceof Error) {
      errorDetails = {
        name: error.name,
        message: error.message,
        stack: error.stack || "No stack trace available.",
      };
    } else if (typeof error === "string") {
      errorDetails.message = error;
    }
    const logErrorEntry = {
      message: `${c.req.method} ${requestTarget} failed`,
      user: authUser?.username,
      level: "fatal",
      method: c.req.method,
      path: url.pathname,
      ip,
      error: errorDetails,
    };

    captureSentryException(error, {
      tags: { source: "request_middleware" },
      extra: {
        method: c.req.method,
        path: url.pathname,
        query: url.search,
        ip,
      },
      user: authUser
        ? { id: authUser.userId, username: authUser.username }
        : undefined,
    });

    const errorLogMessage = JSON.stringify(logErrorEntry);
    // Log message first, then structured attributes for Sentry
    console.error(`${c.req.method} ${requestTarget} failed`, {
      user: authUser?.username,
      method: c.req.method,
      path: url.pathname,
      ip,
      error: errorDetails,
    });
    await appendRequestLogFile(errorLogMessage + "\n");

    // IMPORTANT: Set a generic 500 response so the client doesn't hang.
    c.res = new Response("Internal Server Error", { status: 500 });
  } finally {
    // This block runs for EVERY request, whether it succeeded or failed.
    const end = performance.now();
    const responseTimeMs = end - start;
    const url = new URL(c.req.url);
    const requestTarget = `${url.pathname}${url.search}`;
    const ip = getRequestIp(c.req.raw.headers, c.env?.REMOTE_ADDR);

    const authUser = c.get("user") as AuthUser | undefined;

    // Create the standard log entry for the request-response cycle.
    const level =
      c.res.status >= 500 ? "error" : c.res.status >= 400 ? "warn" : "info";

    const logEntry = {
      message: `${c.req.method} ${requestTarget} -> ${c.res.status}`,
      user: authUser?.username,
      level,
      method: c.req.method,
      path: url.pathname,
      status: c.res.status,
      responseTimeMs: Math.round(responseTimeMs),
      ip,
      ...(level !== "info"
        ? { userAgent: getRequestUserAgent(c.req.raw.headers) }
        : {}),
    };

    const logMessage = JSON.stringify(logEntry);
    // Log message first, then structured attributes for Sentry
    console.log(`${c.req.method} ${requestTarget} -> ${c.res.status}`, {
      user: authUser?.username,
      method: c.req.method,
      path: url.pathname,
      status: c.res.status,
      responseTimeMs: Math.round(responseTimeMs),
      ip,
      ...(level !== "info"
        ? { userAgent: getRequestUserAgent(c.req.raw.headers) }
        : {}),
    });
    await appendRequestLogFile(logMessage + "\n");
  }
});

const DEV_PAGES_RE = /^https:\/\/[a-z0-9-]+\.devthropology\.pages\.dev$/;
const LOCALHOST_RE = /^http:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/;
const ALLOWED = new Set([
  "https://devthropology.com",
  "https://devthropology.pages.dev",
]);

app.use(
  "/*",
  cors({
    origin: (o: string, _c) =>
      o && (ALLOWED.has(o) || DEV_PAGES_RE.test(o) || LOCALHOST_RE.test(o))
        ? o
        : null,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true, // Allow cookies to be sent
  }),
);

// Module-level variables that can be initialized
let repoInstance: IRepository;
let ghApi: GhApi;
let service: Service;
let authzService: AuthorizationService;
let repositoryService: RepositoryService;
let repositoryRepository: RepositoryRepository;
let authenticationIdentityService: AuthenticationIdentityService;
let computedUserMetricsRepository!: ComputedUserMetricsRepository;
let userRelationshipRepository: UserRelationshipRepository;
let userRelationshipService: UserRelationshipService;
let trendsService: TrendsService | null = null;
let reportsService: ReportsService | null = null;
let repositoryContributorsService: RepositoryContributorsService | null = null;
let agentContextService: AgentContextService | null = null;
let teamsService: TeamsService | null = null;
let workspaceRepository: IWorkspaceRepository;
let teamRepository: PostgresTeamRepository | null = null;
// Middleware function that delegates to the current implementation
let currentAuthMiddleware: (
  c: Context,
  next: Next,
) => Promise<Response | void> = (c, _next) => {
  return Promise.resolve(c.text("Auth failure", 500));
};
let currentAuthAndAuthzMiddleware: (
  c: Context,
  next: Next,
) => Promise<Response | void> = (c, _next) => {
  // Explicitly throw error if middleware is not initialized
  return Promise.resolve(c.text("Auth failure", 500));
};

// Wrapper functions that always use the current middleware
const authMiddleware = async (c: Context, next: Next) => {
  return await currentAuthMiddleware(c, next);
};
const authAndAuthzMiddleware = async (c: Context, next: Next) => {
  return await currentAuthAndAuthzMiddleware(c, next);
};
let ghUsername: string | undefined;
let token: string | undefined;
let pgConnectionString: string | null = null;
let sharedSqlClient: SqlClient | null = null;
let reportSqlClient: SqlClient | null = null;
let shutdownStarted = false;

function getRuntimeEnvironment(): string {
  return (
    env.RAILWAY_ENVIRONMENT ??
    env.SENTRY_ENVIRONMENT ??
    env.NODE_ENV ??
    "development"
  );
}

function logStartup(message: string): void {
  console.log(`[startup] ${message}`);
}

function logShutdown(message: string): void {
  console.log(`[shutdown] ${message}`);
}

function logStartupEnvPresence(): void {
  const names = [
    "DATABASE_URL_PG",
    "AUTH_PASSWORD_PEPPER",
    "GH_TOKEN",
    "GH_USER",
    "REPO_OWNER",
    "REPO_NAME",
  ];

  const presence = names.map((name) => {
    const status = env[name] ? "set" : "MISSING";
    return `${name}=${status}`;
  });

  logStartup(`env presence ${presence.join(" ")}`);
}

async function flushSentrySafely(): Promise<void> {
  try {
    await flushSentry();
  } catch (error) {
    console.error("Failed to flush Sentry:", error);
  }
}

async function closeSqlClients(): Promise<void> {
  const clients = [reportSqlClient, sharedSqlClient].filter(
    (client): client is SqlClient => client !== null,
  );

  reportSqlClient = null;
  sharedSqlClient = null;

  await Promise.all(
    clients.map(async (client) => {
      try {
        await client.end({ timeout: 5 });
      } catch (error) {
        console.error("Failed to close PostgreSQL client:", error);
      }
    }),
  );
}

async function exitFromFatalError(
  source: string,
  error: unknown,
  exitCode = 1,
): Promise<void> {
  console.error(`[fatal] ${source}:`, error);
  captureSentryException(error, { tags: { source } });
  await closeSqlClients();
  await flushSentrySafely();
  process.exit(exitCode);
}

function registerFatalErrorHandlers(): void {
  process.on("unhandledRejection", (reason) => {
    if (shouldSuppressExpectedStartupDbError(reason)) return;

    console.error("Unhandled promise rejection:", reason);
    captureSentryException(reason, {
      tags: { source: "unhandledrejection" },
    });

    if (import.meta.main) {
      void exitFromFatalError("unhandledrejection", reason);
    }
  });

  process.on("uncaughtException", (error) => {
    if (shouldSuppressExpectedStartupDbError(error)) return;

    console.error("Uncaught error:", error);
    captureSentryException(error, {
      tags: { source: "global_error" },
    });

    if (import.meta.main) {
      void exitFromFatalError("global_error", error);
    }
  });
}

registerFatalErrorHandlers();

// Initialize with default configuration from environment
async function initializeFromEnv() {
  const start = Date.now();

  const pgUrl = env.DATABASE_URL_PG;
  if (!pgUrl) {
    throw new Error(
      "DATABASE_URL_PG must be configured for authentication services",
    );
  }

  const passwordPepper = env.AUTH_PASSWORD_PEPPER;
  if (!passwordPepper) {
    throw new Error(
      "AUTH_PASSWORD_PEPPER must be configured for authentication services",
    );
  }

  const repoOwner = env.REPO_OWNER!;
  const repoName = env.REPO_NAME!;

  console.log("Using PostgreSQL database...");
  sharedSqlClient = getSharedSqlClient(pgUrl);

  repoInstance = new PostgresRepository(repoOwner, repoName, sharedSqlClient);
  reportSqlClient = env.PG_REPORT_POOL_MAX
    ? createReportSqlClient(pgUrl)
    : null;
  const reportsRepository = reportSqlClient
    ? new PostgresRepository(repoOwner, repoName, reportSqlClient)
    : repoInstance;
  computedUserMetricsRepository = new PostgresComputedUserMetricsRepository(
    sharedSqlClient,
  );
  userRelationshipRepository = new PostgresUserRelationshipRepository(
    sharedSqlClient,
  );
  userRelationshipService = new UserRelationshipService(
    userRelationshipRepository,
  );
  pgConnectionString = pgUrl;
  const authRepository = new PostgresAuthRepository(sharedSqlClient);

  token = env.GH_TOKEN;
  ghUsername = env.GH_USER;
  ghApi = new GhApi(repoOwner, repoName, ghUsername!, token);

  service = new Service(
    repoInstance,
    ghApi,
    computedUserMetricsRepository,
    reportsRepository,
  );
  reportsService = new ReportsService(
    new ReportsRepository(reportSqlClient ?? sharedSqlClient),
  );
  trendsService = new TrendsService(new TrendsRepository(sharedSqlClient));
  repositoryContributorsService = new RepositoryContributorsService(
    new RepositoryContributorsRepository(sharedSqlClient),
  );
  agentContextService = new AgentContextService(repoInstance);

  // Initialize repository service (only for PostgreSQL)
  if (pgUrl) {
    repositoryRepository = new RepositoryRepository(sharedSqlClient);
    repositoryService = new RepositoryService(repositoryRepository);
  }

  teamRepository = new PostgresTeamRepository(sharedSqlClient);
  teamsService = new TeamsService(teamRepository);

  authenticationIdentityService = new AuthenticationIdentityService(
    authRepository,
    {
      passwordPepper,
    },
  );

  const beforeAuth = Date.now();
  console.log(
    `[init] services ready, loading auth cache (${beforeAuth - start}ms)...`,
  );
  await authenticationIdentityService.initialize();
  console.log(`[init] auth cache loaded: ${Date.now() - start}ms`);

  // Initialize workspace repository for authorization
  workspaceRepository = new PostgresWorkspaceRepository(sharedSqlClient);

  authService = new AuthenticationService(authenticationIdentityService);
  authzService = new AuthorizationService(workspaceRepository);
  currentAuthMiddleware = createAuthMiddleware(authService);
  currentAuthAndAuthzMiddleware = createAuthAndAuthzMiddleware(
    authService,
    authzService,
  );

  console.log(`[init] complete: ${Date.now() - start}ms`);
}

async function initializeFromEnvWithRetry(): Promise<void> {
  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    suppressExpectedStartupDbErrorsFor(10_000);

    try {
      await initializeFromEnv();
      clearExpectedStartupDbErrorSuppression();
      return;
    } catch (error) {
      const isTransientConnectionError = isStartupConnectionError(error);
      const hasAttemptsRemaining = attempt < maxAttempts;

      if (!isTransientConnectionError || !hasAttemptsRemaining) {
        clearExpectedStartupDbErrorSuppression();
        throw error;
      }

      const backoffMs = attempt * 1000 + Math.round(Math.random() * 250);
      suppressExpectedStartupDbErrorsFor(backoffMs + 1000);
      console.warn(
        `Database not ready during startup (attempt ${attempt}/${maxAttempts}); retrying in ${backoffMs}ms...`,
      );
      await sleep(backoffMs);
    }
  }
}

// Initialize with provided dependencies (for testing)
async function initializeWithDeps(deps: {
  repository?: IRepository;
  ghApi?: GhApi;
  authService?: AuthenticationService;
  authzService?: AuthorizationService;
  repositoryService?: RepositoryService;
  repositoryRepository?: RepositoryRepository;
  authenticationIdentityService?: AuthenticationIdentityService;
  computedUserMetricsRepository: ComputedUserMetricsRepository;
  userRelationshipRepository?: UserRelationshipRepository;
  workspaceRepository?: IWorkspaceRepository;
  teamRepository?: PostgresTeamRepository;
  trendsService?: TrendsService;
  reportsService?: ReportsService;
  repositoryContributorsService?: RepositoryContributorsService;
  teamsService?: TeamsService;
}) {
  pgConnectionString = null;
  if (!deps.repository) {
    throw new Error("Repository required");
  }
  repoInstance = deps.repository;
  if (!deps.ghApi) {
    throw new Error("GhApi required");
  }
  ghApi = deps.ghApi;
  computedUserMetricsRepository = deps.computedUserMetricsRepository;
  if (deps.userRelationshipRepository) {
    userRelationshipRepository = deps.userRelationshipRepository;
    userRelationshipService = new UserRelationshipService(
      userRelationshipRepository,
    );
  }
  service = new Service(repoInstance, ghApi, computedUserMetricsRepository);
  reportsService = deps.reportsService ?? null;
  trendsService = deps.trendsService ?? null;
  repositoryContributorsService = deps.repositoryContributorsService ?? null;
  agentContextService = new AgentContextService(repoInstance);
  if (!deps.authenticationIdentityService) {
    throw new Error("AuthenticationIdentityService required");
  }
  authenticationIdentityService = deps.authenticationIdentityService;
  await authenticationIdentityService.initialize();

  // Initialize workspace repository if provided
  if (deps.workspaceRepository) {
    workspaceRepository = deps.workspaceRepository;
  }
  if (deps.teamRepository) {
    teamRepository = deps.teamRepository;
  }
  teamsService =
    deps.teamsService ??
    (teamRepository ? new TeamsService(teamRepository) : null);

  authService =
    deps.authService ||
    new AuthenticationService(authenticationIdentityService);
  // For tests, authzService can be provided directly or will default to a no-workspace-repo version
  authzService = deps.authzService || new AuthorizationService();
  currentAuthMiddleware = createAuthMiddleware(authService);
  repositoryRepository =
    deps.repositoryRepository ||
    new RepositoryRepository(createSqlClient("postgresql://test")); // Default for testing
  repositoryService =
    deps.repositoryService || new RepositoryService(repositoryRepository);
  currentAuthAndAuthzMiddleware = createAuthAndAuthzMiddleware(
    authService,
    authzService,
  );
}

// Factory function to create app with optional dependencies
export interface AppDependencies {
  repository?: IRepository;
  ghApi?: GhApi;
  authService?: AuthenticationService;
  authzService?: AuthorizationService;
  authenticationIdentityService?: AuthenticationIdentityService;
  repositoryService?: RepositoryService;
  repositoryRepository?: RepositoryRepository;
  computedUserMetricsRepository: ComputedUserMetricsRepository;
  userRelationshipRepository?: UserRelationshipRepository;
  workspaceRepository?: IWorkspaceRepository;
  teamRepository?: PostgresTeamRepository;
  reportsService?: ReportsService;
}

export async function createApp(deps?: AppDependencies) {
  if (deps) {
    await initializeWithDeps(deps);
  } else {
    await initializeFromEnvWithRetry();
  }

  return {
    app,
    service,
    repository: repoInstance,
    ghApi,
    authService,
    authzService,
    authenticationIdentityService,
  };
}

// Initialize with environment variables by default (for production)
// Only run when this file is the main entry point, not when imported
if (import.meta.main) {
  logStartup(
    `boot env=${getRuntimeEnvironment()} runtime=node/${process.versions.node} railway_service=${env.RAILWAY_SERVICE_NAME ?? "unset"}`,
  );
  logStartupEnvPresence();

  try {
    await initializeFromEnvWithRetry();
  } catch (error) {
    await exitFromFatalError("startup_initialization", error);
  }
}

type ApiRepositoryDetails = {
  id: string;
  org: string;
  name: string;
  last_sync_at?: string | null;
};

function toApiRepositoryDetails(repository: {
  repository_id: number;
  org: string;
  name: string;
  last_sync_at?: string | null;
}): ApiRepositoryDetails {
  return {
    id: encodeRepositoryId(repository.repository_id),
    org: repository.org,
    name: repository.name,
    last_sync_at: repository.last_sync_at ?? null,
  };
}

function resolveRepositoryIdParam(c: Context): number | null {
  const repositoryRef = c.req.param("repositoryId");
  const repositoryId = resolveRepositoryRef(repositoryRef);

  if (repositoryId === null) {
    console.warn(`Repository ref decode failed: ${repositoryRef}`);
    return null;
  }

  if (isLegacyNumericRepositoryRef(repositoryRef)) {
    console.info(`Resolved legacy numeric repository ref ${repositoryRef}`);
  }

  return repositoryId;
}

function resolveTeamIdParam(c: Context): number | null {
  const raw = c.req.param("teamId");
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function getTeamsServiceOrThrow(): TeamsService {
  if (!teamsService) {
    throw new Error("Teams service not initialized");
  }
  return teamsService;
}

function getTrendsServiceOrThrow(): TrendsService {
  if (!trendsService) {
    throw new Error("Trends service not initialized");
  }
  return trendsService;
}

function getRepositoryContributorsServiceOrThrow(): RepositoryContributorsService {
  if (!repositoryContributorsService) {
    throw new Error("Repository contributors service not initialized");
  }
  return repositoryContributorsService;
}

function getAgentContextServiceOrThrow(): AgentContextService {
  if (!agentContextService) {
    throw new Error("Agent context service not initialized");
  }
  return agentContextService;
}

function parseCommaSeparatedSearchParam(url: URL, key: string): string[] {
  const value = url.searchParams.get(key);
  if (!value) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

function createLoginResponse(c: Context, authResult: AuthenticationResult) {
  const { user, token } = authResult;
  const maxAgeSeconds = 60 * 60 * 24 * 365; // one year cookie for long-lived tokens

  c.header(
    "Set-Cookie",
    `auth-token=${token}; HttpOnly; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`,
  );

  return c.json({
    userId: user.userId,
    username: user.username,
    role: user.role,
    token,
  });
}

async function resolveReportUserFilters(
  repositoryId: number,
  explicitUsernames: string[],
  teamSlugs: string[],
): Promise<{ usernames?: string[]; filtersApplied: boolean }> {
  const filtersApplied = explicitUsernames.length > 0 || teamSlugs.length > 0;
  if (!filtersApplied) {
    return { usernames: undefined, filtersApplied: false };
  }

  if (explicitUsernames.length > 0) {
    return {
      usernames: Array.from(new Set(explicitUsernames)),
      filtersApplied: true,
    };
  }

  return {
    usernames: await getTeamsServiceOrThrow().listMemberLoginsByTeamSlugs(
      repositoryId,
      teamSlugs,
    ),
    filtersApplied: true,
  };
}

app.get("/", (c: Context) => {
  return c.text("Hello");
});

function isValidBearerSecret(
  authHeader: string | undefined,
  expectedSecret: string,
): boolean {
  if (!authHeader?.startsWith("Bearer ")) {
    return false;
  }
  const actual = Buffer.from(authHeader.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(expectedSecret, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const SYNC_CRON_LOCK_KEYS = [71423, 202604] as const;

app.get("/api/cron/sync", async (c: Context) => {
  const cronSecret = env.CRON_SECRET;
  if (!cronSecret) {
    return c.json({ error: "CRON_SECRET is not configured" }, 503);
  }
  if (!isValidBearerSecret(c.req.header("authorization"), cronSecret)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  if (!sharedSqlClient) {
    return c.json({ error: "Database unavailable" }, 503);
  }

  const lockConn = await sharedSqlClient.reserve();
  let lockAcquired = false;
  try {
    const [{ acquired }] = await lockConn<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_lock(${SYNC_CRON_LOCK_KEYS[0]}, ${SYNC_CRON_LOCK_KEYS[1]}) AS acquired
    `;
    lockAcquired = acquired;
    if (!lockAcquired) {
      return c.json({ ok: true, skipped: true, reason: "sync_in_progress" });
    }

    const summaries = await runSyncCron(sharedSqlClient);
    const hasError = summaries.some((s) => s.outcomeCode === "PARTIAL_ERROR");
    return c.json(
      {
        ok: !hasError,
        repositories: summaries.length,
        summaries: summaries.map((s) => ({
          org: s.repository.org,
          name: s.repository.name,
          outcomeCode: s.outcomeCode,
          processedCount: s.processedCount,
          requestedCount: s.requestedCount,
        })),
      },
      hasError ? 500 : 200,
    );
  } finally {
    if (lockAcquired) {
      urlCache.clear();
      await lockConn`
        SELECT pg_advisory_unlock(${SYNC_CRON_LOCK_KEYS[0]}, ${SYNC_CRON_LOCK_KEYS[1]})
      `.catch((err) => console.error("Failed to release sync cron lock:", err));
    }
    lockConn.release();
  }
});

app.route(
  "/api/auth/github",
  createGithubLoginRoutes(() => {
    const config = getGithubLoginConfig();
    if (!sharedSqlClient) throw new Error("Database unavailable");
    return new GithubLoginService(
      new GithubLoginRepository(sharedSqlClient),
      config,
    );
  }),
);

app.use("/api/github-connections/*", authMiddleware);
app.route(
  "/api/github-connections",
  createGithubConnectionsRoutes(
    () => {
      if (!sharedSqlClient) throw new Error("Database unavailable");
      return new GithubConnectionsService(
        new GithubConnectionsRepository(sharedSqlClient),
      );
    },
    () => urlCache.clear(),
  ),
);

app.post("/api/auth/login", async (c: Context) => {
  try {
    const body = await c.req.json();
    const usernameRaw = body?.username;
    const passwordRaw = body?.password;

    if (!usernameRaw || !passwordRaw) {
      return c.json({ error: "Username and password are required" }, 400);
    }

    const username = String(usernameRaw);
    const password = String(passwordRaw);

    const authResult = await authService.authenticateWithPassword(
      username,
      password,
    );

    if (!authResult) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    return createLoginResponse(c, authResult);
  } catch (error) {
    console.error("Auth error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.post("/api/auth/demo-login", async (c: Context) => {
  try {
    if (env.ENABLE_DEMO_LOGIN !== "true") {
      return c.json({ error: "Not found" }, 404);
    }

    const username = env.DEMO_USERNAME;
    const password = env.DEMO_PASSWORD;

    if (!username || !password) {
      console.error(
        "Demo login enabled but DEMO_USERNAME or DEMO_PASSWORD is missing",
      );
      return c.json({ error: "Not found" }, 404);
    }

    const authResult = await authService.authenticateWithPassword(
      username,
      password,
    );

    if (!authResult) {
      return c.json({ error: "Demo login failed" }, 401);
    }

    return createLoginResponse(c, authResult);
  } catch (error) {
    console.error("Demo auth error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.get("/api/auth/users", authMiddleware, async (c: Context) => {
  const requester = c.get("user") as AuthUser | undefined;

  if (!requester) {
    return c.json({ error: "Authentication required" }, 401);
  }

  if (requester.role !== "admin" && requester.role !== "superuser") {
    return c.json({ error: "Admin role required" }, 403);
  }

  const users = await authService.listUsers();
  return c.json(users);
});

app.post("/api/auth/users", authMiddleware, async (c: Context) => {
  const requester = c.get("user") as AuthUser | undefined;

  if (!requester) {
    return c.json({ error: "Authentication required" }, 401);
  }

  if (requester.role !== "superuser") {
    return c.json({ error: "Superuser role required" }, 403);
  }

  try {
    const body = await c.req.json();
    const username = String(body?.username ?? "").trim();
    const password = String(body?.password ?? "");
    const role = String(body?.role ?? "").trim();

    if (!username || !password || !role) {
      return c.json(
        { error: "username, password, and role are required" },
        400,
      );
    }

    const newUser = await authenticationIdentityService.createUser(
      username,
      password,
      role,
    );

    // Auto-add demo users to the Demo workspace
    if (role === "demo") {
      try {
        const demoWorkspace = await workspaceRepository.getDemoWorkspace();
        if (demoWorkspace) {
          await workspaceRepository.addUserToWorkspace(
            demoWorkspace.workspaceId,
            newUser.userId,
            "member",
          );
          console.log(`Added demo user ${username} to Demo workspace`);
        } else {
          console.warn(
            "Demo workspace not found, user not added to any workspace",
          );
        }
      } catch (wsError) {
        // Log but don't fail user creation if workspace add fails
        console.error("Failed to add user to Demo workspace:", wsError);
      }
    }

    return c.json(newUser, 201);
  } catch (error) {
    console.error("Auth create user error:", error);
    return c.json({ error: "Unable to create user" }, 500);
  }
});

// ============================================================================
// Workspace Endpoints
// ============================================================================

/**
 * GET /api/workspaces - List workspaces accessible to the user
 *
 * - superuser: returns all workspaces
 * - user: returns workspaces they are a member of
 * - demo: returns empty array (demo users can't manage workspaces)
 */
app.get("/api/workspaces", authMiddleware, async (c: Context) => {
  async function withRepositoryIds<T extends { workspaceId: string }>(
    workspaces: T[],
  ) {
    if (c.req.query("includeRepositories") !== "1") return workspaces;
    return await Promise.all(
      workspaces.map(async (workspace) => ({
        ...workspace,
        repositoryIds: (
          await workspaceRepository.getWorkspaceRepositories(
            workspace.workspaceId,
          )
        ).map(encodeRepositoryId),
      })),
    );
  }

  const user = c.get("user") as AuthUser | undefined;

  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  try {
    if (user.role === "superuser") {
      // Superuser sees all workspaces
      const workspaces = await workspaceRepository.getAllWorkspaces();
      return c.json(await withRepositoryIds(workspaces));
    } else if (user.role === "user") {
      // Users see workspaces they're a member of
      const workspaces = await workspaceRepository.getUserWorkspaces(
        user.userId,
      );
      return c.json(await withRepositoryIds(workspaces));
    } else {
      // Demo users can't manage workspaces
      return c.json([]);
    }
  } catch (error) {
    console.error("Error fetching workspaces:", error);
    return c.json({ error: "Failed to fetch workspaces" }, 500);
  }
});

/**
 * POST /api/workspaces - Create a new workspace
 *
 * - superuser: can create any workspace type
 * - user: can only create 'user' type workspaces, auto-added as owner
 * - demo: 403 forbidden
 */
app.post("/api/workspaces", authMiddleware, async (c: Context) => {
  const user = c.get("user") as AuthUser | undefined;

  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  if (user.role === "demo") {
    return c.json({ error: "Demo users cannot create workspaces" }, 403);
  }

  try {
    const body = await c.req.json();
    const name = String(body?.name ?? "").trim();

    if (!name) {
      return c.json({ error: "Workspace name is required" }, 400);
    }

    // Generate slug from name (lowercase, replace spaces with hyphens)
    const baseSlug = name
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
    const slug = `${baseSlug}-${crypto.randomUUID().slice(0, 8)}`;

    // Users can only create 'user' type workspaces
    const workspaceType =
      user.role === "superuser" ? (body?.workspaceType ?? "user") : "user";

    if (!["demo", "system", "user"].includes(workspaceType)) {
      return c.json({ error: "Invalid workspace type" }, 400);
    }

    const workspace = await workspaceRepository.createWorkspace(
      name,
      slug,
      workspaceType as "demo" | "system" | "user",
      user.userId,
    );

    // Auto-add creator as owner (except for superuser creating system/demo workspaces)
    if (user.role === "user" || workspaceType === "user") {
      await workspaceRepository.addUserToWorkspace(
        workspace.workspaceId,
        user.userId,
        "owner",
      );
    }

    console.log(
      `Created workspace "${name}" (${workspace.workspaceId}) by ${user.username}`,
    );
    return c.json(workspace, 201);
  } catch (error) {
    console.error("Error creating workspace:", error);
    if (error instanceof Error && error.message.includes("unique")) {
      return c.json(
        { error: "A workspace with this name already exists" },
        409,
      );
    }
    return c.json({ error: "Failed to create workspace" }, 500);
  }
});

registerTeamsRoutes(app, {
  authAndAuthzMiddleware,
  resolveRepositoryIdParam,
  resolveTeamIdParam,
  getTeamsService: getTeamsServiceOrThrow,
});

app.get("/debug/:id", authMiddleware, async (c: Context) => {
  try {
    const idNum = Number(c.req.param("id"));
    console.log(idNum);
    const _issue = await ghApi.getFullIssue(idNum);
    const responses = ghApi.getEndpointResponses();

    return c.json(responses);
  } catch (error) {
    console.error("Error in /debug/:id:", error);
    return c.json({ error: "error" }, 500);
  }
});

app.get("/debug/prf/backfill", authMiddleware, async (c: Context) => {
  console.log("Fetching renamed files for backfill");
  const dryRun = c.req.query("dry_run") !== "false"; // Default to dry run unless explicitly set to false

  try {
    // For now, hardcode repository_id to 1 and limit to 10
    const dbFiles = await repoInstance.getRenamedFilesForBackfill(3, 15000);

    // Group by gh_issue_id
    const groupedByIssue = new Map<
      number,
      Array<{
        filename: string;
        pull_request_file_id: number;
        gh_login: string;
        title: string;
        created_at: Date;
      }>
    >();

    for (const file of dbFiles) {
      if (!groupedByIssue.has(file.gh_issue_id)) {
        groupedByIssue.set(file.gh_issue_id, []);
      }
      groupedByIssue.get(file.gh_issue_id)!.push({
        filename: file.filename,
        pull_request_file_id: file.pull_request_file_id,
        gh_login: file.gh_login,
        title: file.title,
        created_at: file.created_at,
      });
    }

    console.log(`Found ${groupedByIssue.size} unique issues to process`);

    if (groupedByIssue.size === 0) {
      return c.json({
        message: "No renamed files found that need backfilling",
        summary: {
          total_db_files: 0,
          unique_issues: 0,
          planned_updates: 0,
          errors: 0,
        },
        update_plan: [],
      });
    }

    console.log(`🔍 PROCESSING ALL ${groupedByIssue.size} ISSUES`);

    const updatePlan: Array<
      | {
          gh_issue_id: number;
          filename: string;
          pull_request_file_id: number;
          current_previous_filename: null;
          would_set_previous_filename_to: string;
          gh_login: string;
          title: string;
          created_at: Date;
        }
      | {
          gh_issue_id: number;
          error: string;
          files_skipped: Array<{
            filename: string;
            pull_request_file_id: number;
          }>;
        }
    > = [];
    const actualUpdates = [];
    let processedIssues = 0;

    // Process ALL issues
    for (const [ghIssueId, dbFileList] of groupedByIssue) {
      processedIssues++;
      console.log(
        `\n📁 Issue ${processedIssues}/${groupedByIssue.size}: gh_issue_id=${ghIssueId} (${dbFileList.length} files)`,
      );
      console.log(`   "${dbFileList[0].title}" by ${dbFileList[0].gh_login}`);

      try {
        const apiFiles = await ghApi.getPullRequestFilesById(ghIssueId);
        console.log(
          `   Fetched ${apiFiles.length} files from GitHub API for issue ${ghIssueId}`,
        );

        // Match by filename
        for (const dbFile of dbFileList) {
          const matchingApiFile = apiFiles.find(
            (apiFile) =>
              apiFile.filename === dbFile.filename &&
              apiFile.status === "renamed",
          );

          if (matchingApiFile && matchingApiFile.previous_filename) {
            const planItem = {
              gh_issue_id: ghIssueId,
              filename: dbFile.filename,
              pull_request_file_id: dbFile.pull_request_file_id,
              current_previous_filename: null,
              would_set_previous_filename_to: matchingApiFile.previous_filename,
              gh_login: dbFile.gh_login,
              title: dbFile.title,
              created_at: dbFile.created_at,
            };
            updatePlan.push(planItem);

            console.log(
              `   ✅ MATCH: filename="${dbFile.filename}", db_id=${dbFile.pull_request_file_id} -> previous_filename="${matchingApiFile.previous_filename}"`,
            );

            if (!dryRun) {
              console.log(
                `   💾 UPDATING DATABASE: pull_request_file_id=${dbFile.pull_request_file_id}`,
              );
              await repoInstance.updatePreviousFilename(
                dbFile.pull_request_file_id,
                matchingApiFile.previous_filename,
              );
              actualUpdates.push({
                pull_request_file_id: dbFile.pull_request_file_id,
                filename: dbFile.filename,
                previous_filename: matchingApiFile.previous_filename,
                status: "updated",
              });
              console.log(
                `   ✅ DATABASE UPDATED for file_id=${dbFile.pull_request_file_id}`,
              );
            }
          } else {
            console.log(
              `   ❌ NO MATCH: filename="${dbFile.filename}", db_id=${dbFile.pull_request_file_id} - API file not found or no previous_filename`,
            );
          }
        }
      } catch (error) {
        console.error(
          `   ❌ Error fetching API data for gh_issue_id ${ghIssueId}:`,
          error,
        );
        updatePlan.push({
          gh_issue_id: ghIssueId,
          error: `Failed to fetch API data: ${
            error instanceof Error ? error.message : String(error)
          }`,
          files_skipped: dbFileList.map((f) => ({
            filename: f.filename,
            pull_request_file_id: f.pull_request_file_id,
          })),
        });
      }
    }

    console.log(`\n🏁 Completed processing ${processedIssues} issues`);

    // Check rate limit at end
    const rateLimitEnd = await ghApi.getRateLimit();
    console.log(`📊 API Calls Left: ${rateLimitEnd.rate.remaining}`);

    return c.json({
      mode: dryRun ? "DRY_RUN" : "LIVE_UPDATE",
      summary: {
        total_db_files: dbFiles.length,
        unique_issues: groupedByIssue.size,
        processed_issues: processedIssues,
        planned_updates: updatePlan.filter((p) => !("error" in p)).length,
        actual_updates: actualUpdates.length,
        errors: updatePlan.filter((p) => "error" in p).length,
      },
      rate_limit: {
        end: {
          remaining: rateLimitEnd.rate.remaining,
          reset_time: new Date(rateLimitEnd.rate.reset * 1000).toISOString(),
        },
      },
      update_plan: updatePlan,
      actual_updates: dryRun ? [] : actualUpdates,
    });
  } catch (error) {
    console.error("Error in backfill process:", error);
    return c.json({ error: "error" }, 500);
  }
});

app.get("/debug/prf/:id", authMiddleware, async (c: Context) => {
  const idNum = Number(c.req.param("id"));
  console.log(`Fetching pull request files for issue ${idNum}`);
  try {
    const files = await ghApi.getPullRequestFilesById(idNum);
    return c.json(files);
  } catch (error) {
    console.error(
      `Error fetching pull request files for issue ${idNum}:`,
      error,
    );
    return c.json({ error: "error" }, 500);
  }
});

app.get(
  "/api/filesystem/:repositoryId/tree",
  authAndAuthzMiddleware,
  async (c: Context) => {
    try {
      const repositoryId = resolveRepositoryIdParam(c);
      const parentPath = c.req.query("parent") || "";
      const levelsParam = c.req.query("levels") || "1";
      const levels = levelsParam.split(",").map((l) => parseInt(l.trim(), 10));

      if (repositoryId === null) {
        return c.json({ error: "Invalid repository ID" }, 400);
      }

      if (levels.some((l) => isNaN(l) || l < 1)) {
        return c.json({ error: "Invalid levels parameter" }, 400);
      }

      console.log(
        `Fetching filesystem tree for repo ${repositoryId}, parent: "${parentPath}", levels: ${levels}`,
      );

      const treeResponse = await service.getFileSystemTree(
        repositoryId,
        parentPath,
        levels,
      );
      return c.json(treeResponse);
    } catch (error) {
      console.error("Error fetching filesystem tree:", error);
      return c.json({ error: "Internal server error" }, 500);
    }
  },
);

app.get(
  "/api/filesystem/:repositoryId/prs",
  authAndAuthzMiddleware,
  async (c: Context) => {
    try {
      const repositoryId = resolveRepositoryIdParam(c);
      const path = c.req.query("path") || "";
      const type = (c.req.query("type") as "file" | "folder") || "folder";
      const limit = Math.min(Number(c.req.query("limit") || "10"), 50);
      const offset = Number(c.req.query("offset") || "0");

      if (repositoryId === null) {
        return c.json({ error: "Invalid repository ID" }, 400);
      }

      if (!path) {
        return c.json({ error: "path query parameter is required" }, 400);
      }

      if (type !== "file" && type !== "folder") {
        return c.json({ error: "type must be 'file' or 'folder'" }, 400);
      }

      if (isNaN(limit) || limit < 1) {
        return c.json({ error: "Invalid limit parameter" }, 400);
      }

      if (isNaN(offset) || offset < 0) {
        return c.json({ error: "Invalid offset parameter" }, 400);
      }

      const result = await service.getFileSystemPRs(
        repositoryId,
        path,
        type,
        limit,
        offset,
      );
      return c.json(result);
    } catch (error) {
      console.error("Error fetching filesystem PRs:", error);
      return c.json({ error: "Internal server error" }, 500);
    }
  },
);

app.get(
  "/api/repository",
  authAndAuthzMiddleware,
  cacheMiddleware,
  async (c: Context) => {
    try {
      const user = c.get("user") as AuthUser | undefined;
      const repositories = await service.getRepositoryDetails();

      // Filter repositories based on user's workspace access
      if (user) {
        const accessibleIds =
          await authzService.getAccessibleRepositoryIds(user);

        // If null, user has access to all (superuser)
        if (accessibleIds !== null) {
          const accessibleSet = new Set(accessibleIds);
          const filtered = repositories.filter((r) =>
            accessibleSet.has(r.repository_id),
          );
          return c.json(filtered.map(toApiRepositoryDetails));
        }
      }

      return c.json(repositories.map(toApiRepositoryDetails));
    } catch (error) {
      console.error("Error fetching repositories:", error);
      if (isTransientDatabaseConnectionError(error)) {
        return c.json({ error: "Database temporarily unavailable" }, 503);
      }
      return c.json({ error: "Internal server error" }, 500);
    }
  },
);

app.post("/api/repository", authAndAuthzMiddleware, async (c: Context) => {
  try {
    const requester = c.get("user") as AuthUser | undefined;

    if (!requester) {
      return c.json({ error: "Authentication required" }, 401);
    }

    if (requester.role !== "superuser") {
      return c.json({ error: "Superuser role required" }, 403);
    }

    if (!repositoryService) {
      return c.json({ error: "Repository service not available" }, 500);
    }

    const body = await c.req.json();
    const { org, name, workspaceId } = body;

    if (!org || !name) {
      return c.json(
        {
          error: "Organization and repository name are required",
        },
        400,
      );
    }

    if (!workspaceId) {
      return c.json(
        {
          error: "workspaceId is required",
        },
        400,
      );
    }

    // Validate workspace exists
    const workspace = await workspaceRepository.getWorkspaceById(workspaceId);
    if (!workspace) {
      return c.json({ error: "Workspace not found" }, 404);
    }

    const repository = await repositoryService.onboardRepositoryInWorkspace(
      org,
      name,
      workspaceId,
      requester.userId,
    );

    console.log(
      `Onboarded repository ${org}/${name} to workspace ${workspace.name} by ${requester.username}`,
    );

    // Clear URL cache since we added a new repository
    urlCache.clear();

    return c.json(repository, 201);
  } catch (error) {
    console.error("Error onboarding repository:", error);
    if (error instanceof Error && error.message.includes("already exists")) {
      return c.json({ error: error.message }, 409);
    }
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.get(
  "/api/github/users/:userName",
  authAndAuthzMiddleware,
  cacheMiddleware,
  async (c: Context) => {
    try {
      const userName = c.req.param("userName");

      if (!userName) {
        return c.json({ error: "GitHub username is required" }, 400);
      }

      const profile = await service.getGithubUserProfile(userName);
      return c.json(profile);
    } catch (error) {
      if (error instanceof RateExceededError) {
        return c.json({ error: error.message }, 429);
      }

      if (error instanceof GithubUserFetchError) {
        const status: ContentfulStatusCode =
          Number.isInteger(error.status) &&
          error.status >= 400 &&
          error.status <= 599
            ? (error.status as ContentfulStatusCode)
            : 500;
        return c.json({ error: error.message }, status);
      }

      console.error("Error fetching GitHub user profile:", error);
      return c.json({ error: "Failed to fetch GitHub user profile" }, 500);
    }
  },
);

app.get(
  "/api/repository/:repositoryId/users/:userName",
  authAndAuthzMiddleware,
  cacheMiddleware,
  async (c: Context) => {
    const repositoryId = resolveRepositoryIdParam(c);
    const userName = c.req.param("userName");
    try {
      if (repositoryId === null) {
        return c.json({ error: "Invalid repository ID" }, 400);
      }

      const stats = await service.getUserStatsForUi(userName, repositoryId);
      return c.json(stats);
    } catch (error) {
      logUserEndpointError("user stats", repositoryId, userName, error);
      return c.json({ error: "Internal server error" }, 500);
    }
  },
);

app.get(
  "/api/repository/:repositoryId/users/:userName/stats/pulls",
  authAndAuthzMiddleware,
  cacheMiddleware,
  async (c: Context) => {
    const repositoryId = resolveRepositoryIdParam(c);
    const userName = c.req.param("userName");
    try {
      const limit = parseInt(c.req.query("limit") || "25", 10);
      const offset = parseInt(c.req.query("offset") || "0", 10);

      if (repositoryId === null) {
        return c.json({ error: "Invalid repository ID" }, 400);
      }

      if (isNaN(limit) || limit <= 0) {
        return c.json({ error: "Invalid limit parameter" }, 400);
      }

      if (isNaN(offset) || offset < 0) {
        return c.json({ error: "Invalid offset parameter" }, 400);
      }

      const pullStats = await service.getUserPullStats(
        userName,
        limit,
        repositoryId,
        offset,
      );
      return c.json(pullStats);
    } catch (error) {
      logUserEndpointError("user pull stats", repositoryId, userName, error);
      return c.json({ error: "Internal server error" }, 500);
    }
  },
);

app.get(
  "/api/repository/:repositoryId/users/:userName/stats/metrics",
  authAndAuthzMiddleware,
  cacheMiddleware,
  async (c: Context) => {
    const repositoryId = resolveRepositoryIdParam(c);
    const userName = c.req.param("userName");
    try {
      if (repositoryId === null) {
        return c.json({ error: "Invalid repository ID" }, 400);
      }

      if (!userName) {
        return c.json({ error: "GitHub username is required" }, 400);
      }

      const metrics = await service.getComputedUserMetrics(
        repositoryId,
        userName,
      );
      return c.json(metrics);
    } catch (error) {
      logUserEndpointError(
        "computed user metrics",
        repositoryId,
        userName,
        error,
      );
      return c.json({ error: "Internal server error" }, 500);
    }
  },
);

app.get(
  "/api/repository/:repositoryId/relationships",
  authAndAuthzMiddleware,
  cacheMiddleware,
  async (c: Context) => {
    try {
      const repositoryId = resolveRepositoryIdParam(c);

      if (repositoryId === null) {
        return c.json({ error: "Invalid repository ID" }, 400);
      }

      const periodParam =
        c.req.query("period") || RELATIONSHIP_PERIOD.THREE_MONTHS;
      if (
        !RELATIONSHIP_PERIODS.includes(
          periodParam as (typeof RELATIONSHIP_PERIODS)[number],
        )
      ) {
        return c.json(
          {
            error: `Invalid period. Must be one of: ${RELATIONSHIP_PERIODS.join(
              ", ",
            )}`,
          },
          400,
        );
      }
      const period = periodParam as (typeof RELATIONSHIP_PERIODS)[number];
      const ghLogin = c.req.query("user") || undefined;
      const minWeightParam = c.req.query("minWeight");
      const minWeight = minWeightParam
        ? parseInt(minWeightParam, 10)
        : undefined;

      if (minWeight !== undefined && (isNaN(minWeight) || minWeight < 0)) {
        return c.json({ error: "Invalid minWeight parameter" }, 400);
      }

      const graph = await userRelationshipService.getRelationshipGraph(
        repositoryId,
        period,
        { ghLogin, minWeight },
      );
      return c.json(graph);
    } catch (error) {
      console.error("Error fetching relationship graph:", error);
      return c.json({ error: "Internal server error" }, 500);
    }
  },
);

app.get(
  "/api/repository/:repositoryId/users/:userName/stats/monthly-metrics",
  authAndAuthzMiddleware,
  cacheMiddleware,
  async (c: Context) => {
    const repositoryId = resolveRepositoryIdParam(c);
    const userName = c.req.param("userName");
    try {
      if (repositoryId === null) {
        return c.json({ error: "Invalid repository ID" }, 400);
      }

      if (!userName) {
        return c.json({ error: "GitHub username is required" }, 400);
      }

      const metrics = await service.getUserMonthlyMetrics(
        repositoryId,
        userName,
      );
      return c.json(metrics);
    } catch (error) {
      logUserEndpointError(
        "user monthly metrics",
        repositoryId,
        userName,
        error,
      );
      return c.json({ error: "Internal server error" }, 500);
    }
  },
);

app.get(
  "/api/repository/:repositoryId/users/:userName/stats/reviews",
  authAndAuthzMiddleware,
  cacheMiddleware,
  async (c: Context) => {
    const repositoryId = resolveRepositoryIdParam(c);
    const userName = c.req.param("userName");
    try {
      const limit = parseInt(c.req.query("limit") || "25", 10);
      const offset = parseInt(c.req.query("offset") || "0", 10);

      if (repositoryId === null) {
        return c.json({ error: "Invalid repository ID" }, 400);
      }

      if (isNaN(limit) || limit <= 0) {
        return c.json({ error: "Invalid limit parameter" }, 400);
      }

      if (isNaN(offset) || offset < 0) {
        return c.json({ error: "Invalid offset parameter" }, 400);
      }

      const reviewStats = await service.getUserReviewStats(
        userName,
        limit,
        repositoryId,
        offset,
      );
      return c.json(reviewStats);
    } catch (error) {
      logUserEndpointError("user review stats", repositoryId, userName, error);
      return c.json({ error: "Internal server error" }, 500);
    }
  },
);

const parseDateRange = (c: Context) => {
  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");

  if (!startDate || !endDate) {
    throw new Error("Both startDate and endDate are required");
  }

  const startDateObj = new Date(startDate);
  const endDateObj = new Date(endDate);

  if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
    throw new Error(
      "Invalid date format. Please use ISO 8601 format (YYYY-MM-DD)",
    );
  }

  return { startDate: startDateObj, endDate: endDateObj };
};

// Repository-scoped authors endpoint
app.get(
  "/api/repository/:repositoryId/authors",
  authAndAuthzMiddleware,
  cacheMiddleware,
  async (c: Context) => {
    try {
      const repositoryId = resolveRepositoryIdParam(c);
      const { startDate, endDate } = parseDateRange(c);
      const url = new URL(c.req.url);
      const explicitUsernames = parseCommaSeparatedSearchParam(url, "users");
      const teamSlugs = parseCommaSeparatedSearchParam(url, "teams");

      if (repositoryId === null) {
        return c.json({ error: "Invalid repository ID" }, 400);
      }

      const { usernames: authorUsernames, filtersApplied } =
        await resolveReportUserFilters(
          repositoryId,
          explicitUsernames,
          teamSlugs,
        );

      if (
        filtersApplied &&
        (!authorUsernames || authorUsernames.length === 0)
      ) {
        return c.json({ authors: [], thresholds: [] });
      }

      console.log(`API: Accessing authors for repository ${repositoryId}`);

      const stats = await service.getAuthorStats(
        startDate,
        endDate,
        repositoryId,
        authorUsernames,
      );
      return c.json(stats);
    } catch (error) {
      console.error("Error fetching author stats:", error);
      if (
        error instanceof Error &&
        error.message === "startDate must be before endDate"
      ) {
        return c.json({ error: error.message }, 400);
      }
      return c.json({ error: "Internal server error" }, 500);
    }
  },
);

// Repository-scoped reviewers endpoint
app.get(
  "/api/repository/:repositoryId/reports/reviewers",
  authAndAuthzMiddleware,
  cacheMiddleware,
  async (c: Context) => {
    try {
      const repositoryId = resolveRepositoryIdParam(c);
      const { startDate, endDate } = parseDateRange(c);
      const url = new URL(c.req.url);
      const explicitUsernames = parseCommaSeparatedSearchParam(url, "users");
      const teamSlugs = parseCommaSeparatedSearchParam(url, "teams");

      if (repositoryId === null) {
        return c.json({ error: "Invalid repository ID" }, 400);
      }

      const { usernames: reviewerUsernames, filtersApplied } =
        await resolveReportUserFilters(
          repositoryId,
          explicitUsernames,
          teamSlugs,
        );

      if (
        filtersApplied &&
        (!reviewerUsernames || reviewerUsernames.length === 0)
      ) {
        return c.json({ reviewers: [], thresholds: [] });
      }

      const stats = await service.getReviewStats(
        startDate,
        endDate,
        repositoryId,
        reviewerUsernames,
      );
      return c.json(stats);
    } catch (error) {
      console.error("Error fetching reviewer stats:", error);
      return c.json({ error: "Internal server error" }, 500);
    }
  },
);

// Test endpoint with auth middleware for testing
app.get("/api/auth-test", authAndAuthzMiddleware, async (c: Context) => {
  const user = await c.get("user");
  const repository = c.get("repository");

  return c.json({
    message: "Auth test successful!",
    user: user,
    repository: repository,
    timestamp: new Date().toISOString(),
  });
});

// Debug endpoint to check auth cache
app.get("/api/debug/auth", authMiddleware, async (c: Context) => {
  const cacheStats = await authService.getCacheStats();
  return c.json({
    message: "Auth cache debug info",
    cacheStats,
    timestamp: new Date().toISOString(),
  });
});

// Repository-scoped reviews endpoint
app.get(
  "/api/repository/:repositoryId/reports/reviews",
  authAndAuthzMiddleware,
  cacheMiddleware,
  async (c: Context) => {
    try {
      const repositoryId = resolveRepositoryIdParam(c);

      if (repositoryId === null) {
        return c.json({ error: "Invalid repository ID" }, 400);
      }

      const ua = await repoInstance.getUserActivity(repositoryId);
      return c.json(ua);
    } catch (error) {
      console.error(error);
      return c.json({ error: "Failed to fetch reviews data" }, 500);
    }
  },
);

registerReportsRoutes(app, {
  authMiddleware,
  getReportsService: () => {
    if (!reportsService) throw new Error("Reports service is not initialized");
    return reportsService;
  },
  getWorkspaceRepository: () => {
    if (!workspaceRepository) {
      throw new Error("Workspace repository is not initialized");
    }
    return workspaceRepository;
  },
  getAuthorizationService: () => authzService,
});

registerTrendsRoutes(app, {
  authAndAuthzMiddleware,
  cacheMiddleware,
  resolveRepositoryIdParam,
  getTrendsService: getTrendsServiceOrThrow,
});

registerRepositoryContributorsRoutes(app, {
  authAndAuthzMiddleware,
  cacheMiddleware,
  resolveRepositoryIdParam,
  getRepositoryContributorsService: getRepositoryContributorsServiceOrThrow,
});

registerAgentContextRoutes(app, {
  authAndAuthzMiddleware,
  getRepository: () => repoInstance,
  getAuthzService: () => authzService,
  getAgentContextService: getAgentContextServiceOrThrow,
});

// Repository-scoped user activity endpoint
app.get(
  "/api/repository/:repositoryId/reports/users/activity",
  authAndAuthzMiddleware,
  cacheMiddleware,
  async (c: Context) => {
    try {
      const repositoryId = resolveRepositoryIdParam(c);

      if (repositoryId === null) {
        return c.json({ error: "Invalid repository ID" }, 400);
      }

      const debugData = await service.getUserActivityOverview(repositoryId);
      return c.json(debugData);
    } catch (error) {
      console.error(error);
      return c.json({ error: "Failed to fetch user activity data" }, 500);
    }
  },
);

// Repository-scoped dashboard endpoint
app.get(
  "/api/repository/:repositoryId/dashboard",
  authAndAuthzMiddleware,
  cacheMiddleware,
  async (c: Context) => {
    try {
      const repositoryId = resolveRepositoryIdParam(c);

      if (repositoryId === null) {
        return c.json({ error: "Invalid repository ID" }, 400);
      }

      const monthsParam = c.req.query("months");
      if (!monthsParam) {
        return c.json(
          {
            error: "months query parameter is required (positive integer)",
          },
          400,
        );
      }

      const months = Number.parseInt(monthsParam, 10);
      if (!Number.isFinite(months) || months <= 0) {
        return c.json(
          {
            error: "months must be a positive integer",
          },
          400,
        );
      }

      const dashboardData = await service.getDashboardData(
        repositoryId,
        new Date(),
        months,
      );
      return c.json(dashboardData);
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
      return c.json({ error: "Internal server error" }, 500);
    }
  },
);

// Repository overview endpoint
app.get(
  "/api/repository/:repositoryId/overview",
  authAndAuthzMiddleware,
  cacheMiddleware,
  async (c: Context) => {
    try {
      const repositoryId = resolveRepositoryIdParam(c);

      if (repositoryId === null) {
        return c.json({ error: "Invalid repository ID" }, 400);
      }

      const overviewData = await service.getRepositoryOverview(repositoryId);

      if (!overviewData) {
        return c.json({ error: "Repository overview not computed yet" }, 404);
      }

      return c.json(overviewData);
    } catch (error) {
      console.error("Error fetching repository overview:", error);
      return c.json({ error: "Internal server error" }, 500);
    }
  },
);

// Repository-scoped merges endpoint
app.get(
  "/api/repository/:repositoryId/reports/merges",
  authAndAuthzMiddleware,
  cacheMiddleware,
  async (c: Context) => {
    try {
      const repositoryId = resolveRepositoryIdParam(c);
      const { startDate, endDate } = parseDateRange(c);

      if (repositoryId === null) {
        return c.json({ error: "Invalid repository ID" }, 400);
      }

      const merges = await service.getMergesByDay(
        startDate,
        endDate,
        repositoryId,
      );
      return c.json(merges);
    } catch (error) {
      console.error("Error fetching merge stats:", error);
      if (
        error instanceof Error &&
        error.message === "startDate must be before endDate"
      ) {
        return c.json({ error: error.message }, 400);
      }
      return c.json({ error: "Internal server error" }, 500);
    }
  },
);

interface BackfillerHandle {
  backfiller: Backfiller;
  cleanup?: () => Promise<void>;
}

async function getBackfiller(
  repositoryId: number,
  options?: BackfillerOptions,
  credentials?: GithubCredentialsProvider,
): Promise<BackfillerHandle> {
  const allRepositories = await repoInstance.getRepositoryDetails();
  const repository = allRepositories.find(
    (r) => r.repository_id === repositoryId,
  );

  if (!repository) {
    console.error(
      `CRITICAL: Repository ${repositoryId} not found in database. Available repositories:`,
      allRepositories
        .map((r) => `${r.repository_id}:${r.org}/${r.name}`)
        .join(", "),
    );
    throw new Error(
      `Repository ${repositoryId} not found - this should not happen`,
    );
  }

  console.log("Switching backfiller to new repository:", repository);
  const newGhApi = new GhApi(
    repository.org,
    repository.name,
    ghUsername!,
    token,
    credentials,
  );
  let repositoryForBackfill: IRepository = repoInstance;
  let metricsRepositoryForBackfill = computedUserMetricsRepository;
  let relationshipServiceForBackfill = userRelationshipService;
  let teamRepositoryForBackfill = teamRepository ?? undefined;
  let trendsRepositoryForBackfill = sharedSqlClient
    ? new TrendsRepository(sharedSqlClient)
    : undefined;
  let repositoryContributorsRepositoryForBackfill = sharedSqlClient
    ? new RepositoryContributorsRepository(sharedSqlClient)
    : undefined;

  if (pgConnectionString && repoInstance instanceof PostgresRepository) {
    const sql = sharedSqlClient ?? getSharedSqlClient(pgConnectionString);
    repositoryForBackfill = new PostgresRepository(
      repository.org,
      repository.name,
      sql,
    );
    metricsRepositoryForBackfill = new PostgresComputedUserMetricsRepository(
      sql,
    );
    relationshipServiceForBackfill = new UserRelationshipService(
      new PostgresUserRelationshipRepository(sql),
    );
    teamRepositoryForBackfill = new PostgresTeamRepository(sql);
    trendsRepositoryForBackfill = new TrendsRepository(sql);
    repositoryContributorsRepositoryForBackfill =
      new RepositoryContributorsRepository(sql);
  } else {
    repositoryForBackfill.updateRepositoryDetails(
      repository.org,
      repository.name,
    );
  }

  const backfillerOptions: BackfillerOptions = {
    ...options,
    archive:
      options?.archive ??
      githubArchiveFromEnv({ owner: repository.org, name: repository.name }),
    computedUserMetricsRepository: metricsRepositoryForBackfill,
    userRelationshipService: relationshipServiceForBackfill,
    teamRepository: teamRepositoryForBackfill,
    trendsRepository: trendsRepositoryForBackfill,
    repositoryContributorsRepository:
      repositoryContributorsRepositoryForBackfill,
  };

  const backfiller = new Backfiller(
    newGhApi,
    repositoryForBackfill,
    backfillerOptions,
  );

  return { backfiller };
}

// Create a function to get a streaming backfiller instance
async function getStreamingBackfiller(
  onProgress: (message: string) => void,
  repositoryId: number,
  options?: {
    onLog?: (event: BackfillLogEvent) => void;
    credentials?: GithubCredentialsProvider;
  },
): Promise<BackfillerHandle> {
  const { backfiller, cleanup } = await getBackfiller(
    repositoryId,
    {
      onLog: options?.onLog,
    },
    options?.credentials,
  );

  // Wrap the backfiller methods to report progress
  const originalBackfillFromLatest =
    backfiller.backfillFromLatest.bind(backfiller);
  backfiller.backfillFromLatest = async (maxRecordsToProcess: number) => {
    onProgress(
      JSON.stringify({
        type: "start",
        message: `Starting backfill from latest with max ${maxRecordsToProcess} records`,
      }),
    );

    try {
      await originalBackfillFromLatest(maxRecordsToProcess);
      onProgress(
        JSON.stringify({
          type: "complete",
          message: `Completed backfill from latest with max ${maxRecordsToProcess} records`,
        }),
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      onProgress(
        JSON.stringify({
          type: "error",
          message: `Error during backfill: ${errorMessage}`,
        }),
      );
      throw error;
    }
  };

  if (typeof backfiller.backfillFromLatestPullRequests === "function") {
    const originalBackfillFromLatestPullRequests =
      backfiller.backfillFromLatestPullRequests.bind(backfiller);
    backfiller.backfillFromLatestPullRequests = async (
      maxRecordsToProcess: number,
    ) => {
      onProgress(
        JSON.stringify({
          type: "start",
          message: `Starting backfill from latest pull requests with max ${maxRecordsToProcess} records`,
        }),
      );

      try {
        await originalBackfillFromLatestPullRequests(maxRecordsToProcess);
        onProgress(
          JSON.stringify({
            type: "complete",
            message: `Completed backfill from latest pull requests with max ${maxRecordsToProcess} records`,
          }),
        );
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        onProgress(
          JSON.stringify({
            type: "error",
            message: `Error during backfill: ${errorMessage}`,
          }),
        );
        throw error;
      }
    };
  }

  if (typeof backfiller.backfillFromLastProcessed === "function") {
    const originalBackfillFromLastProcessed =
      backfiller.backfillFromLastProcessed.bind(backfiller);

    backfiller.backfillFromLastProcessed = async (
      maxRecordsToProcess: number,
    ) => {
      onProgress(
        JSON.stringify({
          type: "start",
          message: `Starting backfill from last seen with max ${maxRecordsToProcess} records`,
        }),
      );

      try {
        await originalBackfillFromLastProcessed(maxRecordsToProcess);
        onProgress(
          JSON.stringify({
            type: "complete",
            message: `Completed backfill from last seen with max ${maxRecordsToProcess} records`,
          }),
        );
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        onProgress(
          JSON.stringify({
            type: "error",
            message: `Error during backfill: ${errorMessage}`,
          }),
        );
        throw error;
      }
    };
  }

  if (typeof backfiller.syncGithubProfiles === "function") {
    const originalSyncGithubProfiles =
      backfiller.syncGithubProfiles.bind(backfiller);

    backfiller.syncGithubProfiles = async (profileCutoffDate: Date) => {
      onProgress(
        JSON.stringify({
          type: "start",
          message: "Starting GitHub profile sync",
        }),
      );

      try {
        await originalSyncGithubProfiles(profileCutoffDate);
        onProgress(
          JSON.stringify({
            type: "complete",
            message: "Completed GitHub profile sync",
          }),
        );
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        onProgress(
          JSON.stringify({
            type: "error",
            message: `Error during GitHub profile sync: ${errorMessage}`,
          }),
        );
        throw error;
      }
    };
  }

  if (typeof backfiller.syncUnsyncedGithubProfiles === "function") {
    const originalSyncUnsyncedGithubProfiles =
      backfiller.syncUnsyncedGithubProfiles.bind(backfiller);

    backfiller.syncUnsyncedGithubProfiles = async () => {
      onProgress(
        JSON.stringify({
          type: "start",
          message: "Starting unsynced GitHub profile sync",
        }),
      );

      try {
        await originalSyncUnsyncedGithubProfiles();
        onProgress(
          JSON.stringify({
            type: "complete",
            message: "Completed unsynced GitHub profile sync",
          }),
        );
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        onProgress(
          JSON.stringify({
            type: "error",
            message: `Error during unsynced GitHub profile sync: ${errorMessage}`,
          }),
        );
        throw error;
      }
    };
  }

  if (typeof backfiller.syncGithubTeams === "function") {
    const originalSyncGithubTeams = backfiller.syncGithubTeams.bind(backfiller);

    backfiller.syncGithubTeams = async () => {
      onProgress(
        JSON.stringify({
          type: "start",
          message: "Starting GitHub team sync",
        }),
      );

      try {
        await originalSyncGithubTeams();
        onProgress(
          JSON.stringify({
            type: "complete",
            message: "Completed GitHub team sync",
          }),
        );
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        onProgress(
          JSON.stringify({
            type: "error",
            message: `Error during GitHub team sync: ${errorMessage}`,
          }),
        );
        throw error;
      }
    };
  }

  return { backfiller, cleanup };
}

// Repository-scoped sync endpoint with SSE streaming
// TODO: Refactor to RESTful route: /api/repository/:repositoryId/sync/stream
// Note: EventSource doesn't support custom headers, so we can't use authAndAuthzMiddleware
app.get("/api/repository/:repositoryId/sync/stream", async (c: Context) => {
  try {
    const repositoryId = resolveRepositoryIdParam(c);
    const count = parseInt(c.req.query("count") || "2000");
    const requestedMode = c.req.query("mode") || "LATEST";
    const mode = requestedMode.toUpperCase();

    if (repositoryId === null) {
      return c.json({ error: "Invalid repository ID" }, 400);
    }

    // Manual authentication for SSE endpoint (EventSource doesn't support custom headers)
    // Try token query parameter first, then Authorization header, then fall back to auth-token cookie
    let token: string | undefined;

    const tokenQuery = c.req.query("token");
    if (tokenQuery) {
      token = tokenQuery;
    } else {
      const authHeader = c.req.header("Authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.slice(7); // Remove "Bearer " prefix
      } else {
        // Extract token from auth-token cookie
        const cookieHeader = c.req.header("Cookie");
        if (cookieHeader) {
          const cookies = cookieHeader.split(";").map((c) => c.trim());
          const authTokenCookie = cookies.find((c) =>
            c.startsWith("auth-token="),
          );

          if (authTokenCookie) {
            token = authTokenCookie.split("=")[1];
          }
        }
      }
    }

    if (!token) {
      return c.json({ error: "Authentication required" }, 401);
    }

    // Validate auth token
    const user = await authService.validateToken(token);
    if (!user) {
      return c.json({ error: "Invalid authentication token" }, 401);
    }

    // Populate user context for downstream handlers/logging
    c.set("user", user);

    // Validate repository access
    const repositories = await service.getRepositoryDetails();
    const repository = repositories.find(
      (r) => r.repository_id === repositoryId,
    );
    if (!repository) {
      return c.json({ error: "Repository not found" }, 404);
    }

    // Check if user has access to this repository
    const hasAccess = await authzService.canAccessRepositoryById(
      user,
      repositoryId,
    );
    if (!hasAccess) {
      return c.json({ error: "Access denied to this repository" }, 403);
    }

    if (isNaN(count) || count <= 0) {
      return c.json({ error: "Count must be a positive number" }, 400);
    }

    if (
      mode !== "LATEST" &&
      mode !== "LAST_SEEN" &&
      mode !== "LATEST_PULL_REQUESTS" &&
      mode !== "SYNC_GITHUB_PROFILES" &&
      mode !== "SYNC_UNSYNCED_GITHUB_PROFILES" &&
      mode !== "SYNC_GITHUB_TEAMS"
    ) {
      return c.json({ error: `Unsupported sync mode: ${requestedMode}` }, 400);
    }

    let profileCutoffDate: Date | null = null;
    if (mode === "SYNC_GITHUB_PROFILES") {
      const profileCutoffDateParam = c.req.query("profileCutoffDate");
      if (!profileCutoffDateParam) {
        return c.json(
          {
            error: "profileCutoffDate is required for SYNC_GITHUB_PROFILES",
          },
          400,
        );
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(profileCutoffDateParam)) {
        return c.json(
          {
            error: "profileCutoffDate must use YYYY-MM-DD format",
          },
          400,
        );
      }

      const parsedProfileCutoffDate = new Date(
        `${profileCutoffDateParam}T00:00:00.000Z`,
      );
      if (
        Number.isNaN(parsedProfileCutoffDate.getTime()) ||
        parsedProfileCutoffDate.toISOString().slice(0, 10) !==
          profileCutoffDateParam
      ) {
        return c.json(
          {
            error: "profileCutoffDate must be a valid date",
          },
          400,
        );
      }

      profileCutoffDate = parsedProfileCutoffDate;
    }

    if (user.role === "demo") {
      return c.json({ error: "Demo accounts cannot start syncs" }, 403);
    }

    let credentials: GithubCredentialsProvider | undefined;
    const syncSql =
      sharedSqlClient ??
      (pgConnectionString ? getSharedSqlClient(pgConnectionString) : undefined);
    if (syncSql) {
      try {
        credentials = await resolveGithubSyncCredentials(
          syncSql,
          user,
          repositoryId,
        );
      } catch (error) {
        if (error instanceof ConnectionError) {
          return c.json({ error: error.message }, 403);
        }
        throw error;
      }
    }

    // Set up SSE headers
    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");
    c.header("X-Accel-Buffering", "no");

    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    let streamClosed = false;

    const readable = new ReadableStream<Uint8Array>({
      start(ctrl: ReadableStreamDefaultController<Uint8Array>) {
        controller = ctrl;
      },
      cancel() {
        streamClosed = true;
      },
    });

    // Function to send SSE messages with error handling
    const sendMessage = (message: string) => {
      if (streamClosed || !controller) {
        return;
      }

      try {
        controller.enqueue(encoder.encode(`data: ${message}\n\n`));
      } catch (error) {
        streamClosed = true;
        console.error("Error sending SSE message:", error);
      }
    };

    const logHistory: BackfillLogEvent[] = [];
    const maxBufferedLogs = 50;

    const sendLogEvent = (event: BackfillLogEvent) => {
      const trimmedMessage = event.message?.trim();
      if (!trimmedMessage) {
        return;
      }

      const payload = JSON.stringify({
        type: "log",
        level: event.level,
        message: event.message,
        timestamp: event.timestamp,
      });

      sendMessage(payload);
    };

    const trackLogEvent = (event: BackfillLogEvent) => {
      const trimmedMessage = event.message?.trim();
      if (!trimmedMessage) {
        return;
      }

      logHistory.push(event);
      if (logHistory.length > maxBufferedLogs) {
        logHistory.shift();
      }

      sendLogEvent(event);
    };

    // Get a streaming backfiller with real-time log forwarding.
    // NOTE: The bounded buffer lets us expose recent logs later without replaying everything.
    const { backfiller, cleanup } = await getStreamingBackfiller(
      sendMessage,
      repositoryId,
      { onLog: trackLogEvent, credentials },
    );

    // Start the backfill process asynchronously
    (async () => {
      try {
        sendMessage(
          JSON.stringify({
            type: "info",
            message: `Starting sync in ${mode} mode with count: ${count}`,
          }),
        );

        // Add a small delay to ensure the message is sent
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Clear URL cache before sync starts
        urlCache.clear();
        console.log("Cache cleared before sync");

        if (mode === "SYNC_GITHUB_PROFILES") {
          await backfiller.syncGithubProfiles(profileCutoffDate!);
        } else if (mode === "SYNC_UNSYNCED_GITHUB_PROFILES") {
          await backfiller.syncUnsyncedGithubProfiles();
        } else if (mode === "SYNC_GITHUB_TEAMS") {
          await backfiller.syncGithubTeams();
        } else if (mode === "LAST_SEEN") {
          await backfiller.backfillFromLastProcessed(count);
        } else if (mode === "LATEST_PULL_REQUESTS") {
          await backfiller.backfillFromLatestPullRequests(count);
        } else {
          await backfiller.backfillFromLatest(count);
        }

        // Send success message and wait a moment before closing
        sendMessage(
          JSON.stringify({
            type: "success",
            message: `Sync completed successfully`,
          }),
        );

        // Send a final message to signal completion
        sendMessage(
          JSON.stringify({
            type: "complete",
            message: "Stream closing normally",
          }),
        );

        // Wait a full second to ensure the message is received before closing
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error: unknown) {
        console.error("SSE: Error during backfill:", error);
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        try {
          sendMessage(
            JSON.stringify({
              type: "error",
              message: `Sync failed: ${errorMessage}`,
            }),
          );
        } catch (sendError) {
          console.error("Failed to send error message via SSE:", sendError);
        }

        // Wait a moment to ensure the message is received before closing
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } finally {
        // Safely close the stream, handling potential errors
        try {
          if (!streamClosed) {
            streamClosed = true;
            if (controller) {
              (
                controller as ReadableStreamDefaultController<Uint8Array>
              ).close();
            }
          }
        } catch (closeError) {
          console.error("Error closing SSE stream:", closeError);
        } finally {
          if (cleanup) {
            try {
              await cleanup();
            } catch (cleanupError) {
              console.error(
                "Error cleaning up backfiller resources:",
                cleanupError,
              );
            }
          }
        }
      }
    })();

    // Create a response with the correct headers explicitly set
    const response = new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });

    return response;
  } catch (error: unknown) {
    console.error("Error setting up streaming sync:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

function resolveListenOptions(): { hostname: string; port: number } {
  const rawPort = env.BACKEND_PORT ?? env.PORT;
  const port = rawPort ? Number(rawPort) : 8000;

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT/BACKEND_PORT value: ${rawPort ?? "unset"}`);
  }

  return { hostname: "0.0.0.0", port };
}

function registerSignalHandlers(
  shutdown: (signal: "SIGTERM" | "SIGINT") => void,
): void {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    try {
      process.on(signal, () => shutdown(signal));
    } catch (error) {
      console.warn(`[startup] failed to register ${signal} handler:`, error);
    }
  }
}

// Only serve when run directly (not when imported for testing)
if (import.meta.main) {
  try {
    const { hostname, port } = resolveListenOptions();
    logStartup(`binding hostname=${hostname} port=${port}`);

    const server = createHttpServer(app.fetch, (error) => {
      console.error("HTTP server request error:", error);
      captureSentryException(error, {
        tags: { source: "http_server_request" },
      });
      return new Response("Internal Server Error", { status: 500 });
    });
    // Attach before listen so bind errors reject rather than going unhandled.
    const finished = once(server, "close");

    registerSignalHandlers((signal) => {
      if (shutdownStarted) return;
      shutdownStarted = true;
      logShutdown(`received ${signal}; stopping server`);
      // Stop accepting connections and drain in-flight requests before DB cleanup.
      server.close();
    });

    server.listen(port, hostname, () => {
      logStartup(
        `listening hostname=${hostname} port=${port} env=${getRuntimeEnvironment()}`,
      );
    });

    if (isSentryConfigured()) {
      process.once("beforeExit", () => {
        void flushSentrySafely();
      });
    }

    await finished;
    if (!shutdownStarted) {
      await exitFromFatalError(
        "server_finished_unexpectedly",
        new Error("HTTP server closed without a shutdown signal"),
      );
    }

    await closeSqlClients();
    await flushSentrySafely();
    logShutdown("complete");
    process.exit(0);
  } catch (error) {
    await exitFromFatalError(
      shutdownStarted ? "server_shutdown" : "server_start",
      error,
    );
  }
}
