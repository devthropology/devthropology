import { HomePageContent, loadHomePageData, meta } from "../pages/home";
import { requireUserSession } from "../utils/session.server";
import type { Route } from "./+types/app.r.$repoRef._index";

export { meta };

export async function loader({ request, params, url }: Route.LoaderArgs) {
  const userSession = await requireUserSession(request, url);
  const repoRef = params.repoRef;

  if (!repoRef) {
    throw new Response("Repository not found", { status: 404 });
  }

  return loadHomePageData(request, userSession.token, repoRef);
}

export default function RepoScopedHomePage({ loaderData }: Route.ComponentProps) {
  return <HomePageContent loaderData={loaderData} />;
}
