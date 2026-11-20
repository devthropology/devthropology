import {
  ContributorsIndexPage,
  handle,
  loadContributorOverviewData,
  meta,
} from "../pages/contributors";
import { requireUserSession } from "../utils/session.server";
import type { Route } from "./+types/app.r.$repoRef.explore.contributors._index";

export { handle, meta };

export async function loader({ request, params, url }: Route.LoaderArgs) {
  const userSession = await requireUserSession(request, url);
  const repoRef = params.repoRef;

  if (!repoRef) {
    throw new Response("Repository not found", { status: 404 });
  }

  return loadContributorOverviewData(request, userSession.token, repoRef);
}

export default function RepoScopedContributorsIndex({ loaderData }: Route.ComponentProps) {
  return <ContributorsIndexPage data={loaderData.data} repositoryId={loaderData.repositoryId} />;
}
