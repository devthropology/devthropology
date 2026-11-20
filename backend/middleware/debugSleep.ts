import { Context, Next } from "hono";
import type { AuthenticationService } from "../authenticationService.ts";
import {
  MAX_DEBUG_SLEEP_MS,
  parseDurationMs,
} from "../../shared/util/debugSleep.ts";
import { sleep } from "../util/sleep.ts";

const MAX_DEBUG_SLEEP_STATE_KEYS = 1000;

type DebugSleepState = {
  initialSleepMs: number;
  reduceByMs: number;
  nextSleepMs: number;
};

type DebugSleepConfig = {
  sleepMs: number;
  reduceByMs: number;
};

type AuthenticationServiceLike = Pick<AuthenticationService, "validateToken">;

function resolveDebugSleepConfig(request: Request): DebugSleepConfig | null {
  const sleepMs = parseDurationMs(
    request.headers.get("x-debug-sleep-ms"),
    MAX_DEBUG_SLEEP_MS,
  );
  if (sleepMs === null) {
    return null;
  }

  const reduceByMs =
    parseDurationMs(
      request.headers.get("x-debug-sleep-reduce-by-ms"),
      MAX_DEBUG_SLEEP_MS,
    ) ?? 0;

  return { sleepMs, reduceByMs };
}

async function isDebugSleepAuthorized(
  request: Request,
  authenticationService?: AuthenticationServiceLike,
): Promise<boolean> {
  if (!authenticationService) {
    return false;
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return false;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return false;
  }

  const user = await authenticationService.validateToken(token);
  return user?.role === "admin" || user?.role === "superuser";
}

function getDebugSleepStateKey(request: Request): string {
  const url = new URL(request.url);
  const clientKey = getForwardableClientIp(request.headers) || "unknown-client";

  return `${clientKey}:${request.method}:${url.pathname}${url.search}`;
}

function resolveAppliedDebugSleep(
  request: Request,
  config: DebugSleepConfig,
  debugSleepStateByKey: Map<string, DebugSleepState>,
): { appliedSleepMs: number; nextSleepMs: number } {
  if (config.reduceByMs <= 0) {
    return {
      appliedSleepMs: config.sleepMs,
      nextSleepMs: config.sleepMs,
    };
  }

  const key = getDebugSleepStateKey(request);
  const existingState = debugSleepStateByKey.get(key);

  if (
    !existingState ||
    existingState.initialSleepMs !== config.sleepMs ||
    existingState.reduceByMs !== config.reduceByMs
  ) {
    if (
      !existingState &&
      debugSleepStateByKey.size >= MAX_DEBUG_SLEEP_STATE_KEYS
    ) {
      debugSleepStateByKey.clear();
    }

    debugSleepStateByKey.set(key, {
      initialSleepMs: config.sleepMs,
      reduceByMs: config.reduceByMs,
      nextSleepMs: config.sleepMs,
    });
  }

  const state = debugSleepStateByKey.get(key)!;
  const appliedSleepMs = state.nextSleepMs;
  state.nextSleepMs = Math.max(0, state.nextSleepMs - state.reduceByMs);

  return {
    appliedSleepMs,
    nextSleepMs: state.nextSleepMs,
  };
}

export function createDebugSleepMiddleware(
  getAuthenticationService: () => AuthenticationServiceLike | undefined,
) {
  const debugSleepStateByKey = new Map<string, DebugSleepState>();

  return async (c: Context, next: Next) => {
    const debugSleepConfig = resolveDebugSleepConfig(c.req.raw);
    if (
      debugSleepConfig &&
      (await isDebugSleepAuthorized(c.req.raw, getAuthenticationService()))
    ) {
      const url = new URL(c.req.url);
      const { appliedSleepMs, nextSleepMs } = resolveAppliedDebugSleep(
        c.req.raw,
        debugSleepConfig,
        debugSleepStateByKey,
      );

      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "info",
          event: "debugSleep",
          method: c.req.method,
          path: url.pathname,
          query: url.search,
          debugSleepMs: debugSleepConfig.sleepMs,
          debugSleepReduceByMs: debugSleepConfig.reduceByMs,
          appliedSleepMs,
          nextSleepMs,
        }),
      );

      if (appliedSleepMs > 0) {
        await sleep(appliedSleepMs);
      }
    }

    await next();
  };
}
import { getForwardableClientIp } from "../requestIp.ts";
