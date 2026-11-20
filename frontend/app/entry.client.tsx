import { HydratedRouter } from "react-router/dom";
import {
  createRoutesFromChildren,
  matchRoutes,
  useLocation,
  useNavigationType,
} from "react-router";
import * as Sentry from "@sentry/react";
import { startTransition, StrictMode, useEffect } from "react";
import { hydrateRoot } from "react-dom/client";
import {
  SENTRY_DSN,
  SENTRY_ENVIRONMENT,
  SENTRY_RELEASE,
  TRACES_SAMPLE_RATE,
  REPLAYS_SESSION_SAMPLE_RATE,
  REPLAYS_ON_ERROR_SAMPLE_RATE,
} from "./sentry.config";

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    enabled: true,
    sendDefaultPii: true,

    integrations: [
      Sentry.reactRouterV7BrowserTracingIntegration({
        useEffect,
        useLocation,
        useNavigationType,
        createRoutesFromChildren,
        matchRoutes,
      }),
      Sentry.replayIntegration(),
      Sentry.consoleLoggingIntegration({
        levels: ["error", "warn"],
      }),
    ],

    tracesSampleRate: TRACES_SAMPLE_RATE,

    tracePropagationTargets: ["localhost", import.meta.env.VITE_BACKEND_API_URL].filter(
      (target): target is string => Boolean(target),
    ),

    replaysSessionSampleRate: REPLAYS_SESSION_SAMPLE_RATE,
    replaysOnErrorSampleRate: REPLAYS_ON_ERROR_SAMPLE_RATE,
    environment: SENTRY_ENVIRONMENT,
    release: SENTRY_RELEASE,

    enableLogs: true,
  });
}

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  );
});
