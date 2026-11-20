import type { LoaderFunction } from "react-router";
import { API_URL, apiFetch } from "~/config";
import { REPO_ID_KEY } from "~/utils/repositoryPreferences";
import { fetchRepositoriesWithRetry } from "~/utils/repositoryRequests";
import { chooseBestRepository } from "~/utils/repositorySelection";
import {
  createUserSession,
  getRepositoryIdFromCookie,
  getUserSession,
} from "~/utils/session.server";

const DEMO_DEFAULT_REPOSITORY_ORG = "getsentry";
const DEMO_DEFAULT_REPOSITORY_NAME = "sentry";

type LoginResponse = {
  userId: string;
  username: string;
  role: string;
  token: string;
};

export const loader: LoaderFunction = async ({ request }) => {
  const userSession = await getUserSession(request);

  if (userSession) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/app" },
    });
  }

  try {
    const response = await apiFetch(`${API_URL}/api/auth/demo-login`, {
      method: "POST",
      request,
      retryCount: 2,
    });

    if (!response.ok) {
      console.error("Demo login failed:", response.status);
      return new Response("Demo is unavailable", { status: 503 });
    }

    const userData = (await response.json()) as LoginResponse;
    let repositoryCookie = "";

    try {
      const repositories = await fetchRepositoriesWithRetry(userData.token, {
        request,
      });

      const savedRepositoryId = getRepositoryIdFromCookie(request);
      const savedRepository = savedRepositoryId
        ? repositories.find((repository) => repository.id === savedRepositoryId)
        : null;
      const selectedRepository =
        savedRepository ??
        repositories.find(
          (repository) =>
            repository.org === DEMO_DEFAULT_REPOSITORY_ORG &&
            repository.name === DEMO_DEFAULT_REPOSITORY_NAME,
        ) ??
        chooseBestRepository(repositories);

      if (selectedRepository) {
        repositoryCookie = `${REPO_ID_KEY}=${encodeURIComponent(
          selectedRepository.id,
        )}; Path=/; Max-Age=${60 * 60 * 24 * 365}`;
      }
    } catch (error) {
      console.error("Failed to fetch repositories during demo login:", error);
    }

    return createUserSession(
      userData.userId,
      userData.username,
      userData.role,
      userData.token,
      "/app",
      repositoryCookie,
    );
  } catch (error) {
    console.error("Demo login error:", error);
    return new Response("Demo is unavailable", { status: 503 });
  }
};

export default function Demo() {
  return null;
}
