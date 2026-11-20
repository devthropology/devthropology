import { getRequestListener } from "@hono/node-server";
import { createServer } from "node:http";

/** Keep native Request/Response globals while adapting Node HTTP to Hono. */
export function createHttpServer(
  fetch: (
    request: Request,
    bindings: { REMOTE_ADDR: string | undefined },
  ) => Response | Promise<Response>,
  onError: (error: unknown) => Response,
) {
  return createServer(
    getRequestListener(
      (request, bindings) =>
        fetch(request, { REMOTE_ADDR: bindings.incoming.socket.remoteAddress }),
      { overrideGlobalObjects: false, errorHandler: onError },
    ),
  );
}
