import { env } from "node:process";
import * as Sentry from "@sentry/node";
import { consoleLoggingIntegration, type Integration } from "@sentry/core";

type SentryUser = {
  id?: string;
  username?: string;
};

type CaptureContext = {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: SentryUser;
};

let isSentryEnabled = false;

function parseSampleRate(rawValue: string | undefined): number | undefined {
  const parsedValue = rawValue ? Number(rawValue) : Number.NaN;
  if (!Number.isFinite(parsedValue) || parsedValue < 0 || parsedValue > 1) {
    return undefined;
  }
  return parsedValue;
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === "string") {
    return new Error(error);
  }

  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error(String(error));
  }
}

export function initSentry(): void {
  const dsn = env.SENTRY_DSN;
  if (!dsn) {
    console.log("Sentry disabled: SENTRY_DSN is not set");
    return;
  }

  const environment = env.SENTRY_ENVIRONMENT ?? "development";
  const release = env.SENTRY_RELEASE ?? undefined;
  const tracesSampleRate = parseSampleRate(env.SENTRY_TRACES_SAMPLE_RATE);

  Sentry.init({
    dsn,
    environment,
    release,
    tracesSampleRate,
    enableLogs: true,
    integrations: (defaults: Integration[]) => [
      // Application handlers own suppression, cleanup, and bounded flushing.
      // Do not let the SDK independently capture suppressed startup errors or
      // race the application shutdown path with its own fatal-error handlers.
      ...defaults.filter(
        (integration) =>
          integration.name !== "OnUnhandledRejection" &&
          integration.name !== "OnUncaughtException",
      ),
      // Keep warn/error as error events for Issues.
      Sentry.captureConsoleIntegration({ levels: ["warn", "error"] }),
      // Forward info/log/warn/error to Sentry Logs.
      consoleLoggingIntegration({ levels: ["log", "info", "warn", "error"] }),
    ],
  });

  isSentryEnabled = true;
  console.log(`Sentry initialized for environment "${environment}"`);
}

export function captureException(
  error: unknown,
  context?: CaptureContext,
): void {
  if (!isSentryEnabled) {
    return;
  }

  const normalizedError = normalizeError(error);

  if (!context) {
    Sentry.captureException(normalizedError);
    return;
  }

  Sentry.withScope((scope) => {
    if (context.tags) {
      scope.setTags(context.tags);
    }
    if (context.extra) {
      scope.setExtras(context.extra);
    }
    if (context.user) {
      scope.setUser(context.user);
    }

    Sentry.captureException(normalizedError);
  });
}

export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!isSentryEnabled) {
    return;
  }

  await Sentry.flush(timeoutMs);
}

export function isSentryConfigured(): boolean {
  return isSentryEnabled;
}
