const DEFAULT_ENVIRONMENT = import.meta.env.DEV ? "development" : "production";

// Build-time; Sentry stays disabled when unset.
export const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN || undefined;
export const SENTRY_ENVIRONMENT = import.meta.env.VITE_SENTRY_ENVIRONMENT || DEFAULT_ENVIRONMENT;
export const SENTRY_RELEASE = import.meta.env.VITE_SENTRY_RELEASE || undefined;

export const TRACES_SAMPLE_RATE = 0.2;
export const REPLAYS_SESSION_SAMPLE_RATE = 0.1;
export const REPLAYS_ON_ERROR_SAMPLE_RATE = 1.0;
