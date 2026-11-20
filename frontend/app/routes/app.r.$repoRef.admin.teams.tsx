import TeamsPage, { loadTeamsPageData } from "../pages/adminTeams";
import { requireAdminSession } from "../utils/adminAccess.server";
import type { Route } from "./+types/app.r.$repoRef.admin.teams";

export async function loader({ request, params, url }: Route.LoaderArgs) {
  const userSession = await requireAdminSession(request, url);
  const repoRef = params.repoRef;

  return loadTeamsPageData(request, userSession.token, repoRef ?? null);
}

export default TeamsPage;
