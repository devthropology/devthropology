import { redirect } from "react-router";
import { fetchRepositoriesWithRetry } from "../utils/repositoryRequests";
import { chooseBestRepository, sortRepositories } from "../utils/repositorySelection";
import { buildRepoScopedPath } from "../utils/repositoryRoutes";
import { getRepositoryIdFromCookie, requireUserSession } from "../utils/session.server";
import type { Route } from "./+types/app._index";

export async function loader({ request, url }: Route.LoaderArgs) {
  const userSession = await requireUserSession(request, url);
  const requestUrl = url;
  const repositories = sortRepositories(
    await fetchRepositoriesWithRetry(userSession.token, { request }),
  );
  const repositoryId = getRepositoryIdFromCookie(request);
  const selectedRepository = chooseBestRepository(repositories, repositoryId);

  if (selectedRepository) {
    throw redirect(`${buildRepoScopedPath(selectedRepository.id)}${requestUrl.search}`);
  }

  throw redirect("/app/settings");
}
