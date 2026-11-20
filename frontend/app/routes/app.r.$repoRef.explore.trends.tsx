import TrendsPage, { loadTrendsData, meta } from "../pages/trends";
import { requireUserSession } from "../utils/session.server";
import type { Route } from "./+types/app.r.$repoRef.explore.trends";

export { meta };

export async function loader({ request, params, url }: Route.LoaderArgs) {
  const userSession = await requireUserSession(request, url);
  const repoRef = params.repoRef;

  if (!repoRef) {
    throw new Response("Repository not found", { status: 404 });
  }

  return loadTrendsData(request, userSession.token, repoRef);
}

export default TrendsPage;
