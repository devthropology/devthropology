import { type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { API_URL, authenticatedFetch } from "../config";
import { requireUserSession } from "../utils/session.server";

export async function action({ params, request, url }: ActionFunctionArgs) {
  const userSession = await requireUserSession(request, url);
  const repoRef = params.repoRef;
  const teamId = params.teamId;
  const view = url.searchParams.get("view");

  if (!repoRef || !teamId) {
    throw new Response("Repository or team not selected", { status: 400 });
  }

  if (request.method !== "PATCH") {
    throw new Response("Method not allowed", { status: 405 });
  }

  const body = await request.text();
  const targetUrl =
    view === "members"
      ? `${API_URL}/api/repository/${repoRef}/teams/${teamId}/members`
      : `${API_URL}/api/repository/${repoRef}/teams/${teamId}`;
  const response = await authenticatedFetch(targetUrl, userSession.token, {
    method: "PATCH",
    request,
    headers: {
      "Content-Type": "application/json",
    },
    body,
  });

  return new Response(await response.text(), {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "application/json",
    },
  });
}

export async function loader({ params, request, url }: LoaderFunctionArgs) {
  const userSession = await requireUserSession(request, url);
  const repoRef = params.repoRef;
  const teamId = params.teamId;
  const view = url.searchParams.get("view");

  if (!repoRef || !teamId) {
    throw new Response("Repository or team not selected", { status: 400 });
  }

  if (view !== "members") {
    throw new Response("Not found", { status: 404 });
  }

  const response = await authenticatedFetch(
    `${API_URL}/api/repository/${repoRef}/teams/${teamId}/members`,
    userSession.token,
    { request },
  );

  if (!response.ok) {
    throw new Response("Failed to fetch team members", { status: response.status });
  }

  return await response.json();
}
