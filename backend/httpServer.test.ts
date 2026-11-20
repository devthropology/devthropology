import { test } from "vitest";
import { deepStrictEqual, rejects, strictEqual } from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import { createHttpServer } from "./httpServer.ts";

async function listen(server: Server): Promise<string> {
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await listening;
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("No TCP address");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server) {
  if (!server.listening) return;
  const closed = once(server, "close");
  server.close();
  server.closeAllConnections();
  await closed;
}

test("HTTP adapter preserves native globals, request bodies, cookies and remote address", async () => {
  const nativeRequest = Request;
  const nativeResponse = Response;
  const server = createHttpServer(
    async (request, bindings) => {
      const headers = new Headers({ "content-type": "application/json" });
      headers.append("set-cookie", "first=1; HttpOnly");
      headers.append("set-cookie", "second=2; HttpOnly");
      return new Response(
        JSON.stringify({
          method: request.method,
          body: await request.text(),
          pathname: new URL(request.url).pathname,
          remote: bindings.REMOTE_ADDR,
        }),
        { status: 201, headers },
      );
    },
    () => new Response("error", { status: 500 }),
  );
  try {
    const url = await listen(server);
    strictEqual(Request, nativeRequest);
    strictEqual(Response, nativeResponse);
    const response = await fetch(`${url}/echo`, {
      method: "POST",
      body: "é中文",
    });
    strictEqual(response.status, 201);
    deepStrictEqual(response.headers.getSetCookie(), [
      "first=1; HttpOnly",
      "second=2; HttpOnly",
    ]);
    deepStrictEqual(await response.json(), {
      method: "POST",
      body: "é中文",
      pathname: "/echo",
      remote: "127.0.0.1",
    });
    const head = await fetch(url, { method: "HEAD" });
    strictEqual(head.status, 201);
    strictEqual(await head.text(), "");
  } finally {
    await close(server);
  }
});

test("HTTP adapter reports request failures and remains available", async () => {
  const errors: unknown[] = [];
  const failure = new Error("request failed");
  const server = createHttpServer(
    () => Promise.reject(failure),
    (error) => {
      errors.push(error);
      return new Response("Internal Server Error", { status: 500 });
    },
  );
  try {
    const url = await listen(server);
    for (let i = 0; i < 2; i++) {
      const response = await fetch(url);
      strictEqual(response.status, 500);
      strictEqual(await response.text(), "Internal Server Error");
    }
    deepStrictEqual(errors, [failure, failure]);
  } finally {
    await close(server);
  }
});

test("HTTP adapter streams SSE and drains active requests on close", async () => {
  let finish!: () => void;
  const encoder = new TextEncoder();
  const server = createHttpServer(
    () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode("data: first\n\n"));
          finish = () => {
            controller.enqueue(encoder.encode("data: last\n\n"));
            controller.close();
          };
        },
      });
      return new Response(stream, {
        headers: { "Content-Type": "text/event-stream" },
      });
    },
    () => new Response("error", { status: 500 }),
  );
  try {
    const url = await listen(server);
    const response = await fetch(url);
    const reader = response.body!.getReader();
    const first = await reader.read();
    strictEqual(new TextDecoder().decode(first.value), "data: first\n\n");
    let closed = false;
    const finished = once(server, "close").then(() => {
      closed = true;
    });
    server.close();
    strictEqual(closed, false);
    finish();
    let remaining = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      remaining += new TextDecoder().decode(chunk.value);
    }
    strictEqual(remaining, "data: last\n\n");
    await finished;
  } finally {
    await close(server);
  }
});

test("HTTP adapter exposes bind failures to the lifecycle listener", async () => {
  const handler = () => new Response("ok");
  const server = createHttpServer(handler, handler);
  const duplicate = createHttpServer(handler, handler);
  try {
    const url = new URL(await listen(server));
    const finished = once(duplicate, "close");
    duplicate.listen(Number(url.port), "127.0.0.1");
    await rejects(finished, { code: "EADDRINUSE" });
  } finally {
    await close(server);
    await close(duplicate);
  }
});
