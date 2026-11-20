import { MAX_DEBUG_SLEEP_MS, parseDurationMs } from "../../shared/util/debugSleep";
import { captureException } from "./utils/sentry";

// Check if we're in development by checking the NODE_ENV
const isDevelopment = process.env.NODE_ENV === "development";

const devBackendApiUrl = import.meta.env.VITE_BACKEND_API_URL;
const devBackendPort = import.meta.env.VITE_BACKEND_PORT;
const devBackendUrlFromPort = devBackendPort ? `http://localhost:${devBackendPort}` : undefined;

// Self-hosted and Vercel SSR read runtime settings; browser calls use the same-origin proxy/rewrite.
const rawApiUrl =
  import.meta.env.SELF_HOSTED || import.meta.env.VERCEL
    ? import.meta.env.SSR
      ? process.env.BACKEND_API_URL ||
        process.env.VITE_BACKEND_API_URL ||
        `http://localhost:${process.env.VITE_BACKEND_PORT || "8000"}`
      : window.location.origin
    : isDevelopment
      ? devBackendApiUrl || devBackendUrlFromPort || "http://localhost:8000"
      : import.meta.env.VITE_BACKEND_API_URL;

export const API_URL = rawApiUrl?.replace(/\/+$/, "");

const DEFAULT_TIMEOUT_MS = 7000;
// Keep safe GETs alive long enough for Railway's sleeping Postgres service to wake.
const DEFAULT_SAFE_METHOD_RETRY_COUNT = 4;
const FAST_WAKE_RETRY_DELAYS_MS = [0, 150, 450, 1000];
const DATABASE_WAKE_RETRY_DELAYS_MS = [0, 5000, 10000, 15000];
const SAFE_RETRY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const SLOW_REQUEST_LOG_THRESHOLD_MS = 2000;
// Optional page URL params for manual cold-start simulation, e.g.
// ?debugSleepMs=8s&debugSleepReduceByMs=2s&debugSleepPaths=/api/repository,/api/repository/1/overview
const DEBUG_SLEEP_QUERY_PARAM = "debugSleepMs";
const DEBUG_SLEEP_REDUCE_QUERY_PARAM = "debugSleepReduceByMs";
const DEBUG_SLEEP_PATHS_QUERY_PARAM = "debugSleepPaths";
const FORWARDED_CLIENT_IP_HEADER = "x-devthropology-client-ip";

export const REQUEST_LABELS = [
  "app.repositories",
  "home.overview",
  "home.contributorInsights",
  "home.monthly",
  "home.dashboard",
] as const;

export type RequestLabel = (typeof REQUEST_LABELS)[number];

function createAbortError(message = "Request aborted"): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string") {
    return new Error(error);
  }
  return new Error("Request failed");
}

function formatDurationMs(value: number): string {
  return `${Math.round(value)}ms`;
}

function buildRequestLabel(method: string, url: string, label?: RequestLabel): string {
  if (label) {
    return label;
  }

  try {
    const parsedUrl = new URL(url);
    return `${method} ${parsedUrl.pathname}${parsedUrl.search}`;
  } catch {
    return `${method} ${url}`;
  }
}

function getUrlPathForSentry(url: string): string {
  try {
    const parsedUrl = new URL(url);
    return `${parsedUrl.pathname}${parsedUrl.search}`;
  } catch {
    return url;
  }
}

function extractFirstForwardedIp(forwardedFor: string | null): string | null {
  if (!forwardedFor) {
    return null;
  }

  return forwardedFor.split(",")[0]?.trim() || null;
}

export function getForwardableClientIp(request: Request): string | null {
  const cloudflareClientIp =
    request.headers.get("true-client-ip") || request.headers.get("cf-connecting-ip");
  if (cloudflareClientIp) {
    return cloudflareClientIp;
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  const firstForwardedIp = extractFirstForwardedIp(forwardedFor);
  if (firstForwardedIp) {
    return firstForwardedIp;
  }

  return request.headers.get("x-real-ip");
}

function getForwardableUserAgent(request: Request): string | null {
  return request.headers.get("user-agent");
}

function captureApiFetchFailure(
  error: unknown,
  {
    method,
    url,
    requestLabel,
    attempts,
    timeoutMs,
    status,
    kind,
  }: {
    method: string;
    url: string;
    requestLabel: string;
    attempts: number;
    timeoutMs: number;
    status?: number;
    kind: "retryable_status" | "exhausted_attempts";
  },
) {
  captureException(error, {
    tags: {
      area: "apiFetch",
      kind,
      method,
      requestLabel,
    },
    extra: {
      attempts,
      status,
      timeoutMs,
      url: getUrlPathForSentry(url),
    },
  });
}

function resolveDebugSleepMs(request?: Request): string | null {
  if (!request) {
    return null;
  }

  const parsed = parseDurationMs(
    new URL(request.url).searchParams.get(DEBUG_SLEEP_QUERY_PARAM),
    MAX_DEBUG_SLEEP_MS,
  );
  return parsed === null ? null : parsed.toString();
}

function resolveDebugSleepReduceByMs(request?: Request): string | null {
  if (!request) {
    return null;
  }

  const parsed = parseDurationMs(
    new URL(request.url).searchParams.get(DEBUG_SLEEP_REDUCE_QUERY_PARAM),
    MAX_DEBUG_SLEEP_MS,
  );
  return parsed === null ? null : parsed.toString();
}

function resolveDebugSleepPaths(request?: Request): string[] {
  if (!request) {
    return [];
  }

  const rawValue = new URL(request.url).searchParams.get(DEBUG_SLEEP_PATHS_QUERY_PARAM);
  if (!rawValue) {
    return [];
  }

  return rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function pathMatchesDebugTarget(pattern: string, pathname: string): boolean {
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);
    return prefix.length > 0 && pathname.startsWith(prefix);
  }

  return pathname === pattern;
}

function shouldApplyDebugSleep(targetUrl: string, configuredPaths: string[]): boolean {
  if (configuredPaths.length === 0) {
    return true;
  }

  try {
    const pathname = new URL(targetUrl).pathname;
    return configuredPaths.some((pattern) => pathMatchesDebugTarget(pattern, pathname));
  } catch {
    return false;
  }
}

function getRetryDelayMs(
  retryAttemptNumber: number,
  retryDelayMs?: number,
  databaseWakeRetry = false,
): number {
  if (retryDelayMs !== undefined) {
    return Math.max(0, retryDelayMs);
  }

  const delays = databaseWakeRetry ? DATABASE_WAKE_RETRY_DELAYS_MS : FAST_WAKE_RETRY_DELAYS_MS;
  const baseDelay = delays[Math.min(retryAttemptNumber - 1, delays.length - 1)];
  const jitter = databaseWakeRetry ? 0 : Math.floor(Math.random() * 80);
  return baseDelay + jitter;
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason instanceof Error ? signal.reason : createAbortError());
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort);
      }
    }
  });
}

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS_CODES.has(status);
}

function resolveRetryCount(method: string, retryCount?: number): number {
  if (retryCount !== undefined) {
    return Math.max(0, retryCount);
  }
  return SAFE_RETRY_METHODS.has(method) ? DEFAULT_SAFE_METHOD_RETRY_COUNT : 0;
}

export interface ApiFetchOptions extends RequestInit {
  request?: Request;
  timeoutMs?: number;
  retryCount?: number;
  retryDelayMs?: number;
  token?: string;
  label?: RequestLabel;
}

export interface AuthenticatedFetchOptions extends Omit<ApiFetchOptions, "token"> {}

export async function apiFetch(url: string, options?: ApiFetchOptions) {
  const {
    request,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retryCount,
    retryDelayMs,
    token,
    label,
    signal: externalSignalRaw,
    ...fetchOptions
  } = options ?? {};
  const externalSignal = externalSignalRaw ?? undefined;

  const method = (fetchOptions.method ?? "GET").toUpperCase();
  const attempts = Math.max(1, resolveRetryCount(method, retryCount) + 1);
  const requestLabel = buildRequestLabel(method, url, label);
  const overallStart = performance.now();
  const headers = new Headers(fetchOptions.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  // If request is provided (server-side), forward the client IP
  if (request) {
    const clientIp = getForwardableClientIp(request);
    if (clientIp) {
      headers.set(FORWARDED_CLIENT_IP_HEADER, clientIp);
      headers.set("X-Forwarded-For", clientIp);
    }

    const userAgent = getForwardableUserAgent(request);
    if (userAgent) {
      headers.set("X-Original-User-Agent", userAgent);
    }
  }

  const debugSleepPaths = resolveDebugSleepPaths(request);
  const shouldAttachDebugSleepHeaders = shouldApplyDebugSleep(url, debugSleepPaths);

  const debugSleepMs = shouldAttachDebugSleepHeaders ? resolveDebugSleepMs(request) : null;
  if (debugSleepMs && !headers.has("X-Debug-Sleep-Ms")) {
    headers.set("X-Debug-Sleep-Ms", debugSleepMs);
  }

  const debugSleepReduceByMs = shouldAttachDebugSleepHeaders
    ? resolveDebugSleepReduceByMs(request)
    : null;
  if (debugSleepReduceByMs && !headers.has("X-Debug-Sleep-Reduce-By-Ms")) {
    headers.set("X-Debug-Sleep-Reduce-By-Ms", debugSleepReduceByMs);
  }

  let attempt = 0;
  let lastError: unknown;
  let databaseWakeRetry = false;

  while (attempt < attempts) {
    databaseWakeRetry = false;
    if (externalSignal?.aborted) {
      throw externalSignal.reason instanceof Error ? externalSignal.reason : createAbortError();
    }

    const controller = new AbortController();
    let didTimeout = false;
    const attemptStart = performance.now();
    const requestTimeoutId =
      timeoutMs > 0
        ? setTimeout(() => {
            didTimeout = true;
            controller.abort();
          }, timeoutMs)
        : undefined;
    const abortHandler = () => controller.abort(externalSignal?.reason);

    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort(externalSignal.reason);
      } else {
        externalSignal.addEventListener("abort", abortHandler);
      }
    }

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        headers,
        signal: controller.signal,
      });
      const attemptDurationMs = performance.now() - attemptStart;
      const totalDurationMs = performance.now() - overallStart;

      if (!response.ok && isRetryableStatus(response.status) && attempt < attempts - 1) {
        console.warn(
          `[apiFetch] ${requestLabel} returned ${response.status} in ${formatDurationMs(
            attemptDurationMs,
          )} on attempt ${attempt + 1}/${attempts}; retrying...`,
        );
        lastError = new Error(`HTTP ${response.status} ${response.statusText || "Server Error"}`);
        databaseWakeRetry = response.status === 503;
      } else {
        if (response.ok && (attempt > 0 || totalDurationMs >= SLOW_REQUEST_LOG_THRESHOLD_MS)) {
          console.info(
            `[apiFetch] ${requestLabel} succeeded with ${response.status} in ${formatDurationMs(
              totalDurationMs,
            )} after ${attempt + 1} attempt(s)`,
          );
        }

        if (!response.ok && isRetryableStatus(response.status)) {
          const err = new Error(
            `[apiFetch] ${requestLabel} returned ${response.status} after ${attempts} attempt(s)`,
          );
          console.error(err.message);
          captureApiFetchFailure(err, {
            kind: "retryable_status",
            method,
            url,
            requestLabel,
            attempts,
            timeoutMs,
            status: response.status,
          });
        }
        return response;
      }
    } catch (error) {
      if (externalSignal?.aborted) {
        throw toError(error);
      }

      lastError = error;
      const canRetry = (didTimeout || !isAbortError(error)) && attempt < attempts - 1;
      const attemptDurationMs = performance.now() - attemptStart;

      if (didTimeout) {
        console.warn(
          `[apiFetch] ${requestLabel} timed out after ${timeoutMs}ms on attempt ${attempt + 1}/${
            attempts
          } (${formatDurationMs(attemptDurationMs)})${canRetry ? "; retrying..." : ""}`,
        );
      } else if (canRetry) {
        console.warn(
          `[apiFetch] ${requestLabel} failed in ${formatDurationMs(attemptDurationMs)} on attempt ${
            attempt + 1
          }/${attempts}; retrying...`,
          error,
        );
      } else {
        console.error(
          `[apiFetch] ${requestLabel} failed in ${formatDurationMs(attemptDurationMs)} on attempt ${
            attempt + 1
          }/${attempts}:`,
          error,
        );
        throw toError(error);
      }
    } finally {
      if (requestTimeoutId !== undefined) {
        clearTimeout(requestTimeoutId);
      }
      if (externalSignal) {
        externalSignal.removeEventListener("abort", abortHandler);
      }
    }

    attempt += 1;

    if (attempt < attempts) {
      const delay = getRetryDelayMs(attempt, retryDelayMs, databaseWakeRetry);
      if (delay > 0) {
        await sleep(delay, externalSignal);
      }
    }
  }

  console.error(`[apiFetch] Exhausted ${attempts} attempt(s) for ${requestLabel}`, lastError);

  const exhaustionError =
    lastError instanceof Error
      ? lastError
      : new Error(`[apiFetch] ${requestLabel} failed after ${attempts} attempt(s)`);

  captureApiFetchFailure(exhaustionError, {
    kind: "exhausted_attempts",
    method,
    url,
    requestLabel,
    attempts,
    timeoutMs,
  });

  throw exhaustionError;
}

export async function authenticatedFetch(
  url: string,
  token: string,
  options?: AuthenticatedFetchOptions,
) {
  return await apiFetch(url, {
    ...options,
    token,
  });
}
