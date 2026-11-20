import { AuthorReportsPage, handle, loadAuthorReportsData, meta } from "../pages/reportsAuthors";
import { buildRepoScopedPath } from "../utils/repositoryRoutes";
import { requireUserSession } from "../utils/session.server";
import type { Route } from "./+types/app.r.$repoRef.reports.authors";

export { handle, meta };

export async function loader({ request, params, url }: Route.LoaderArgs) {
  const userSession = await requireUserSession(request, url);
  const repoRef = params.repoRef;

  if (!repoRef) {
    throw new Response("Repository not found", { status: 404 });
  }

  return loadAuthorReportsData(request, userSession.token, repoRef);
}

export default function RepoScopedAuthorReports({ loaderData, params }: Route.ComponentProps) {
  if (!params.repoRef) {
    throw new Response("Repository not found", { status: 404 });
  }

  const basePath = buildRepoScopedPath(params.repoRef, "/reports/authors");

  return (
    <AuthorReportsPage
      loaderData={loaderData}
      buildPath={(search) => (search ? `${basePath}?${search}` : basePath)}
      repoRef={params.repoRef}
    />
  );
}
