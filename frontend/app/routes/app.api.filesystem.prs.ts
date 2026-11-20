import { type LoaderFunctionArgs } from "react-router";
import { API_URL, authenticatedFetch } from "../config";
import { getRepositoryIdFromCookie, requireUserSession } from "../utils/session.server";

export async function loader({ request, url }: LoaderFunctionArgs) {
  const userSession = await requireUserSession(request, url);
  const repositoryId = url.searchParams.get("repositoryId") ?? getRepositoryIdFromCookie(request);

  if (!repositoryId) {
    throw new Response("Repository not selected", { status: 400 });
  }

  const path = url.searchParams.get("path") || "";
  const type = url.searchParams.get("type") || "folder";
  const limit = url.searchParams.get("limit") || "25";
  const offset = url.searchParams.get("offset") || "0";

  const response = await authenticatedFetch(
    `${API_URL}/api/filesystem/${repositoryId}/prs?path=${encodeURIComponent(path)}&type=${type}&limit=${limit}&offset=${offset}`,
    userSession.token,
    { request },
  );

  if (!response.ok) {
    throw new Response("Failed to fetch filesystem PRs", { status: response.status });
  }

  return await response.json();
}
