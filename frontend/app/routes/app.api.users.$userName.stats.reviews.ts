import { type LoaderFunctionArgs } from "react-router";
import { API_URL, authenticatedFetch } from "../config";
import { getRepositoryIdFromCookie, requireUserSession } from "../utils/session.server";

export async function loader({ params, request, url }: LoaderFunctionArgs) {
  const userSession = await requireUserSession(request, url);
  const userName = params.userName ?? "";
  const repositoryId = url.searchParams.get("repositoryId") ?? getRepositoryIdFromCookie(request);

  if (!repositoryId) {
    throw new Response("Repository not selected", { status: 400 });
  }

  const limit = url.searchParams.get("limit") || "25";
  const offset = url.searchParams.get("offset") || "0";

  const response = await authenticatedFetch(
    `${API_URL}/api/repository/${repositoryId}/users/${userName}/stats/reviews?limit=${limit}&offset=${offset}`,
    userSession.token,
    { request },
  );

  if (!response.ok) {
    throw new Response("Failed to fetch review stats", { status: response.status });
  }

  return await response.json();
}
