import Relationships, {
  handle,
  loadRelationshipsData,
  meta,
  shouldRevalidate,
} from "../pages/relationships";
import { requireUserSession } from "../utils/session.server";
import type { Route } from "./+types/app.r.$repoRef.relationships";

export { handle, meta, shouldRevalidate };

export async function loader({ request, params, url }: Route.LoaderArgs) {
  const userSession = await requireUserSession(request, url);
  const repoRef = params.repoRef;

  if (!repoRef) {
    throw new Response("Repository not found", { status: 404 });
  }

  return loadRelationshipsData(request, userSession.token, repoRef);
}

export default Relationships;
