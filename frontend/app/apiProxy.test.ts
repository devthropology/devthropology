import { afterEach, describe, expect, it, vi } from "vitest";
import { RouterContextProvider, type LoaderFunctionArgs } from "react-router";
import { action, loader } from "./apiProxy";

vi.mock("./config", () => ({ API_URL: "http://localhost:8003" }));

afterEach(() => vi.unstubAllGlobals());

function args(request: Request): LoaderFunctionArgs {
  return {
    request,
    url: new URL(request.url),
    params: {},
    context: new RouterContextProvider(),
    pattern: "/api/*",
  };
}

describe("self-hosted API proxy", () => {
  it("preserves path, query, auth headers and upstream response without following redirects", async () => {
    const response = new Response(null, {
      status: 302,
      headers: { Location: "/next", "Set-Cookie": "test=value; HttpOnly" },
    });
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);
    const result = await loader(
      args(
        new Request("http://localhost:3003/api/items?q=one", {
          headers: { Host: "localhost:3003", Authorization: "Bearer test" },
        }),
      ),
    );
    expect(result).toBe(response);
    const [upstream, options] = fetchMock.mock.calls[0];
    expect(upstream.url).toBe("http://localhost:8003/api/items?q=one");
    expect(upstream.headers.has("host")).toBe(false);
    expect(upstream.headers.get("authorization")).toBe("Bearer test");
    expect(options.redirect).toBe("manual");
  });

  it("forwards POST bodies and error responses unchanged", async () => {
    const response = new Response("invalid", { status: 422 });
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await action(
        args(
          new Request("http://localhost:3003/api/items", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "test" }),
          }),
        ),
      ),
    ).toBe(response);
    const upstream = fetchMock.mock.calls[0][0] as Request;
    expect(upstream.method).toBe("POST");
    expect(await upstream.json()).toEqual({ name: "test" });
  });

  it("does not buffer streaming responses", async () => {
    const response = new Response(new ReadableStream(), {
      headers: { "Content-Type": "text/event-stream" },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const result = await loader(args(new Request("http://localhost:3003/api/events")));
    expect(result).toBe(response);
    expect(result.bodyUsed).toBe(false);
    await result.body?.cancel();
  });
});
