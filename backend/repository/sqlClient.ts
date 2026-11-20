import { env } from "node:process";
import { Signer } from "@aws-sdk/rds-signer";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import postgres from "postgres";

export type SqlClient = ReturnType<typeof postgres>;

// Vercel's AWS Aurora PostgreSQL integration injects these with a `PG_` prefix.
const AURORA_ENV = {
  host: "PG_PGHOST",
  port: "PG_PGPORT",
  database: "PG_PGDATABASE",
  user: "PG_PGUSER",
  sslmode: "PG_PGSSLMODE",
  region: "PG_AWS_REGION",
  roleArn: "PG_AWS_ROLE_ARN",
} as const;

/**
 * Connection string from DATABASE_URL_PG, or one derived from the Vercel AWS
 * Aurora integration (IAM auth, no password) when only PG_PGHOST is set.
 */
export function resolveDatabaseUrl(): string | undefined {
  if (env.DATABASE_URL_PG) return env.DATABASE_URL_PG;
  const host = env[AURORA_ENV.host];
  if (!host) return undefined;
  const user = encodeURIComponent(env[AURORA_ENV.user] ?? "postgres");
  const port = env[AURORA_ENV.port] ?? "5432";
  const database = encodeURIComponent(env[AURORA_ENV.database] ?? "postgres");
  const sslmode = env[AURORA_ENV.sslmode] ?? "require";
  return `postgres://${user}@${host}:${port}/${database}?sslmode=${sslmode}`;
}

let iamPassword: (() => Promise<string>) | undefined;

/** Signs a short-lived RDS IAM token per connection when using Aurora IAM auth. */
function resolveIamPassword(connectionString: string) {
  const host = env[AURORA_ENV.host];
  const roleArn = env[AURORA_ENV.roleArn];
  if (env.DATABASE_URL_PG || !host || !roleArn) return undefined;
  if (!connectionString.includes(`@${host}:`)) return undefined;
  if (!iamPassword) {
    const region = env[AURORA_ENV.region];
    const signer = new Signer({
      hostname: host,
      port: Number(env[AURORA_ENV.port] ?? 5432),
      username: env[AURORA_ENV.user] ?? "postgres",
      region,
      credentials: awsCredentialsProvider({
        roleArn,
        clientConfig: { region },
      }),
    });
    iamPassword = () => signer.getAuthToken();
  }
  return iamPassword;
}

/** resolveDatabaseUrl() with a freshly signed IAM token embedded, for tools like dbmate. */
export async function resolveDatabaseUrlWithPassword(): Promise<
  string | undefined
> {
  const url = resolveDatabaseUrl();
  const pass = url && resolveIamPassword(url);
  if (!url || !pass) return url;
  const withPassword = new URL(url);
  // URL.password leaves '%' undecoded-safe chars as-is; the IAM token contains
  // literal %2F sequences, so percent-encode it fully.
  withPassword.password = encodeURIComponent(await pass());
  return withPassword.toString();
}

function createPool(connectionString: string, options: PoolOptions) {
  const pass = resolveIamPassword(connectionString);
  return postgres(connectionString, pass ? { ...options, pass } : options);
}

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
  return createPool(connectionString, options);
}

export function createReportSqlClient(connectionString: string): SqlClient {
  const options = resolveReportPoolOptions();
  logPoolCreation(connectionString, options, "report");
  return createPool(connectionString, options);
}

export function getSharedSqlClient(connectionString: string): SqlClient {
  const existing = sharedClients.get(connectionString);
  if (existing) {
    return existing;
  }
  const options = resolvePoolOptions();
  logPoolCreation(connectionString, options, "shared");
  const client = createPool(connectionString, options);
  sharedClients.set(connectionString, client);
  return client;
}
