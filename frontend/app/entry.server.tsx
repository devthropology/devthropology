import type { EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import * as Sentry from "@sentry/cloudflare";
import { isbot } from "isbot";
import * as ReactDOMServer from "react-dom/server";
import { isIgnorableRouteError } from "./utils/sentry";
const { renderToReadableStream } = ReactDOMServer;

export const streamTimeout = 30_000;

function captureServerException(error: unknown): void {
  if (process.env.SENTRY_DSN || process.env.VITE_SENTRY_DSN) {
    Sentry.captureException(error);
  }
}

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext,
) {
  try {
    const body = await renderToReadableStream(
      <ServerRouter context={reactRouterContext} url={request.url} />,
      {
        onError(error: unknown) {
          if (isIgnorableRouteError(error)) {
            console.warn(error instanceof Error ? error.message : error);
            return;
          }

          console.error(error);
          captureServerException(error);
          responseStatusCode = 500;
        },
      },
    );

    if (isbot(request.headers.get("user-agent"))) {
      await body.allReady;
    }

    responseHeaders.set("Content-Type", "text/html");

    return new Response(body, {
      headers: responseHeaders,
      status: responseStatusCode,
    });
  } catch (error) {
    if (isIgnorableRouteError(error)) {
      console.warn(error instanceof Error ? error.message : error);
      return new Response("Not Found", { status: 404 });
    }

    console.error("Error in handleRequest:", error);
    captureServerException(error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
