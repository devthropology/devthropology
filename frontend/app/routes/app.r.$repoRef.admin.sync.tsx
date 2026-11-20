import SyncPage, { loadSyncPageData } from "../pages/adminSync";
import { requireAdminSession } from "../utils/adminAccess.server";
import type { Route } from "./+types/app.r.$repoRef.admin.sync";

export async function loader({ request, params, url }: Route.LoaderArgs) {
  const userSession = await requireAdminSession(request, url);
  const repoRef = params.repoRef;

  return loadSyncPageData(request, userSession.token, repoRef ?? null);
}

export default SyncPage;
