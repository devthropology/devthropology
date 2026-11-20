import {
  ReviewerReportsPage,
  handle,
  loadReviewerReportsData,
  meta,
} from "../pages/reportsReviewers";
import { buildRepoScopedPath } from "../utils/repositoryRoutes";
import { requireUserSession } from "../utils/session.server";
import type { Route } from "./+types/app.r.$repoRef.reports.reviewers";

export { handle, meta };

export async function loader({ request, params, url }: Route.LoaderArgs) {
  const userSession = await requireUserSession(request, url);
  const repoRef = params.repoRef;

  if (!repoRef) {
    throw new Response("Repository not found", { status: 404 });
  }

  return loadReviewerReportsData(request, userSession.token, repoRef);
}

export default function RepoScopedReviewerReports({ loaderData, params }: Route.ComponentProps) {
  if (!params.repoRef) {
    throw new Response("Repository not found", { status: 404 });
  }

  const basePath = buildRepoScopedPath(params.repoRef, "/reports/reviewers");

  return (
    <ReviewerReportsPage
      loaderData={loaderData}
      buildPath={(search) => (search ? `${basePath}?${search}` : basePath)}
      repoRef={params.repoRef}
    />
  );
}
