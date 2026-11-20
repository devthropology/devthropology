import { env } from "node:process";
import postgres from "postgres";

export type SqlClient = ReturnType<typeof postgres>;

type PoolOptions = {
  max: number;
  idle_timeout: number;
  max_lifetime: number;
  connect_timeout: number;
};

const DEFAULT_OPTIONS: PoolOptions = {
  max: 10,
  idle_timeout: 30,
  max_lifetime: 60 * 10,
  connect_timeout: 3,
};

const sharedClients = new Map<string, SqlClient>();

function parseEnvInt(name: string, fallback: number): number {
  const raw = env[name];
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseEnvIntWithFallbacks(names: string[], fallback: number): number {
  for (const name of names) {
    const raw = env[name];
    if (!raw) continue;

    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return fallback;
}

function resolvePoolOptions(): PoolOptions {
  return {
    max: parseEnvInt("PG_POOL_MAX", DEFAULT_OPTIONS.max),
    idle_timeout: parseEnvInt(
      "PG_POOL_IDLE_TIMEOUT",
      DEFAULT_OPTIONS.idle_timeout,
    ),
    max_lifetime: parseEnvInt(
      "PG_POOL_MAX_LIFETIME",
      DEFAULT_OPTIONS.max_lifetime,
    ),
    connect_timeout: parseEnvInt(
      "PG_CONNECT_TIMEOUT",
      DEFAULT_OPTIONS.connect_timeout,
    ),
  };
}

function resolveReportPoolOptions(): PoolOptions {
  return {
    max: parseEnvIntWithFallbacks(
      ["PG_REPORT_POOL_MAX", "PG_POOL_MAX"],
      DEFAULT_OPTIONS.max,
    ),
    idle_timeout: parseEnvIntWithFallbacks(
      ["PG_REPORT_POOL_IDLE_TIMEOUT", "PG_POOL_IDLE_TIMEOUT"],
      DEFAULT_OPTIONS.idle_timeout,
    ),
    max_lifetime: parseEnvIntWithFallbacks(
      ["PG_REPORT_POOL_MAX_LIFETIME", "PG_POOL_MAX_LIFETIME"],
      DEFAULT_OPTIONS.max_lifetime,
    ),
    connect_timeout: parseEnvIntWithFallbacks(
      ["PG_REPORT_CONNECT_TIMEOUT", "PG_CONNECT_TIMEOUT"],
      DEFAULT_OPTIONS.connect_timeout,
    ),
  };
}

function formatConnectionInfo(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const db = url.pathname.replace(/^\//, "") || "(default)";
    const host = url.hostname || "localhost";
    const port = url.port || "(default)";
    return `${url.protocol}//${host}:${port}/${db}`;
  } catch {
    return "[invalid-connection-string]";
  }
}

function logPoolCreation(
  connectionString: string,
  options: PoolOptions,
  label: string,
) {
  console.log(
    `sqlclient: ${label} pool created for ${formatConnectionInfo(
      connectionString,
    )} max=${options.max} idle_timeout=${options.idle_timeout}s max_lifetime=${options.max_lifetime}s connect_timeout=${options.connect_timeout}s`,
  );
}

export function createSqlClient(connectionString: string): SqlClient {
  const options = resolvePoolOptions();
  logPoolCreation(connectionString, options, "standalone");
  return postgres(connectionString, options);
}

export function createReportSqlClient(connectionString: string): SqlClient {
  const options = resolveReportPoolOptions();
  logPoolCreation(connectionString, options, "report");
  return postgres(connectionString, options);
}

export function getSharedSqlClient(connectionString: string): SqlClient {
  const existing = sharedClients.get(connectionString);
  if (existing) {
    return existing;
  }
  const options = resolvePoolOptions();
  logPoolCreation(connectionString, options, "shared");
  const client = postgres(connectionString, options);
  sharedClients.set(connectionString, client);
  return client;
}
