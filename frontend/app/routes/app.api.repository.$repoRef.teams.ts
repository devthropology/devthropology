import { type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { API_URL, authenticatedFetch } from "../config";
import { requireUserSession } from "../utils/session.server";

export async function loader({ params, request, url }: LoaderFunctionArgs) {
  const userSession = await requireUserSession(request, url);
  const repoRef = params.repoRef;
  const view = url.searchParams.get("view");

  if (!repoRef) {
    throw new Response("Repository not selected", { status: 400 });
  }

  const targetUrl =
    view === "available-users"
      ? `${API_URL}/api/repository/${repoRef}/teams/available-users`
      : `${API_URL}/api/repository/${repoRef}/teams`;

  const response = await authenticatedFetch(targetUrl, userSession.token, { request });

  if (!response.ok) {
    throw new Response(
      view === "available-users" ? "Failed to fetch available users" : "Failed to fetch teams",
      { status: response.status },
    );
  }

  return await response.json();
}

export async function action({ params, request, url }: ActionFunctionArgs) {
  const userSession = await requireUserSession(request, url);
  const repoRef = params.repoRef;

  if (!repoRef) {
    throw new Response("Repository not selected", { status: 400 });
  }

  if (request.method !== "POST") {
    throw new Response("Method not allowed", { status: 405 });
  }

  const body = await request.text();
  const response = await authenticatedFetch(
    `${API_URL}/api/repository/${repoRef}/teams`,
    userSession.token,
    {
      method: "POST",
      request,
      headers: {
        "Content-Type": "application/json",
      },
      body,
    },
  );

  return new Response(await response.text(), {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "application/json",
    },
  });
}
