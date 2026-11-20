import type { LoaderFunctionArgs } from "react-router";
import { API_URL } from "./config";

// Registered only in the self-hosted build; Cloudflare routes are unchanged.
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  headers.delete("host");
  const init = {
    method: request.method,
    headers,
    body: request.body,
    signal: request.signal,
    duplex: "half", // Node fetch requires this for streaming request bodies.
  };
  const upstream = new Request(new URL(url.pathname + url.search, API_URL), init);
  return fetch(upstream, { redirect: "manual" });
}

export const action = loader;
