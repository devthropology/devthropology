import type { CaptureContext } from "@sentry/core";

type SentryCaptureModule = {
  captureException: (error: unknown, context?: CaptureContext) => string;
};

let sentryModulePromise: Promise<SentryCaptureModule> | undefined;

function isRouteErrorResponseLike(error: unknown): error is { status: number } {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
  );
}

export function isIgnorableRouteError(error: unknown): boolean {
  if (isRouteErrorResponseLike(error) && error.status === 404) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.startsWith("No route matches URL ") ||
    error.message.startsWith("No routes matched location ")
  );
}

async function resolveSentryModule(): Promise<SentryCaptureModule> {
  if (import.meta.env.SSR) {
    const Sentry = await import("@sentry/cloudflare");
    return {
      captureException(error, context) {
        return Sentry.captureException(
          error,
          context as Parameters<typeof Sentry.captureException>[1],
        );
      },
    };
  }

  const Sentry = await import("@sentry/react");
  return {
    captureException(error, context) {
      return Sentry.captureException(
        error,
        context as Parameters<typeof Sentry.captureException>[1],
      );
    },
  };
}

function loadSentryModule(): Promise<SentryCaptureModule> {
  if (!sentryModulePromise) {
    sentryModulePromise = resolveSentryModule();
  }

  return sentryModulePromise;
}

export function captureException(error: unknown, context?: CaptureContext): void {
  if (isIgnorableRouteError(error)) {
    return;
  }

  void loadSentryModule()
    .then((Sentry) => {
      Sentry.captureException(error, context);
    })
    .catch((captureError) => {
      console.error("[sentry] Failed to capture exception", captureError);
    });
}
