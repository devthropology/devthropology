import { getRepositoryIdFromCookie, requireUserSession } from "~/utils/session.server";
import { InShellNotFound } from "../components/InShellNotFound";
import type { Route } from "./+types/app.$";

export async function loader({ request, url }: Route.LoaderArgs) {
  const userSession = await requireUserSession(request, url);
  const requestUrl = url;

  console.warn("Rejected unknown app route", {
    pathname: requestUrl.pathname,
    search: requestUrl.search,
    cookieRepositoryId: getRepositoryIdFromCookie(request) ?? null,
    userId: userSession.userId,
    username: userSession.username,
  });

  return null;
}

export default function UnknownAppRoute() {
  return (
    <InShellNotFound
      title="Page not found"
      message="This route is not available. Use the navigation to continue."
    />
  );
}
