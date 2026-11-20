import { useParams } from "react-router";
import {
  ContributorDetailPage,
  ContributorDetailErrorBoundary,
  loadContributorDetailData,
  meta,
} from "../pages/contributorDetails";
import { buildRepoScopedPath } from "../utils/repositoryRoutes";
import { requireUserSession } from "../utils/session.server";
import type { Route } from "./+types/app.r.$repoRef.explore.contributors.$userName";

export { meta };

export async function loader({ request, params, url }: Route.LoaderArgs) {
  const userSession = await requireUserSession(request, url);
  const repoRef = params.repoRef;
  const userName = params.userName ?? "unknown";

  if (!repoRef) {
    throw new Response("Repository not found", { status: 404 });
  }

  return loadContributorDetailData(request, userSession.token, repoRef, userName);
}

export default function RepoScopedContributorDetails({ loaderData, params }: Route.ComponentProps) {
  if (!params.repoRef) {
    throw new Response("Repository not found", { status: 404 });
  }

  const backPath = buildRepoScopedPath(params.repoRef, "/explore/contributors");

  return <ContributorDetailPage loaderData={loaderData} buildBackPath={() => backPath} />;
}

export function ErrorBoundary() {
  const backPath = buildRepoScopedPath(useCurrentRepoRefOrThrow(), "/explore/contributors");

  return <ContributorDetailErrorBoundary backPath={backPath} />;
}

function useCurrentRepoRefOrThrow() {
  const repoRef = useParams().repoRef;

  if (!repoRef) {
    throw new Response("Repository not found", { status: 404 });
  }

  return repoRef;
}
