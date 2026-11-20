import * as Sentry from "@sentry/cloudflare";

type SentryBindings = {
  SENTRY_DSN?: string;
  VITE_SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  VITE_SENTRY_ENVIRONMENT?: string;
  SENTRY_RELEASE?: string;
  VITE_SENTRY_RELEASE?: string;
  SENTRY_TRACES_SAMPLE_RATE?: string;
  CF_PAGES_BRANCH?: string;
  CF_PAGES_COMMIT_SHA?: string;
};

function getDefaultEnvironment(env: SentryBindings): string {
  if (env.CF_PAGES_BRANCH) {
    return env.CF_PAGES_BRANCH === "main" || env.CF_PAGES_BRANCH === "master"
      ? "production"
      : "preview";
  }

  return "development";
}

function getTracesSampleRate(rawValue: string | undefined): number {
  const parsedValue = rawValue ? Number(rawValue) : Number.NaN;
  return Number.isFinite(parsedValue) ? parsedValue : 0.2;
}

export const onRequest = [
  Sentry.sentryPagesPlugin<SentryBindings>((context) => {
    // Sentry stays disabled when no DSN is configured.
    const dsn = context.env.SENTRY_DSN || context.env.VITE_SENTRY_DSN || undefined;
    const environment =
      context.env.SENTRY_ENVIRONMENT ||
      context.env.VITE_SENTRY_ENVIRONMENT ||
      getDefaultEnvironment(context.env);
    const release =
      context.env.SENTRY_RELEASE ||
      context.env.VITE_SENTRY_RELEASE ||
      context.env.CF_PAGES_COMMIT_SHA;

    return {
      dsn,
      enabled: Boolean(dsn),
      environment,
      release,
      tracesSampleRate: getTracesSampleRate(context.env.SENTRY_TRACES_SAMPLE_RATE),
      sendDefaultPii: true,
      enableLogs: true,
      integrations: [Sentry.consoleLoggingIntegration({ levels: ["error", "warn"] })],
    };
  }),
];
