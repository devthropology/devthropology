import FileSystemPage, {
  handle,
  loadFilesystemData,
  meta,
  shouldRevalidate,
} from "../pages/filesystem";
import { requireUserSession } from "../utils/session.server";
import type { Route } from "./+types/app.r.$repoRef.explore.filesystem";

export { handle, meta, shouldRevalidate };

export async function loader({ request, params, url }: Route.LoaderArgs) {
  const userSession = await requireUserSession(request, url);
  const repoRef = params.repoRef;

  if (!repoRef) {
    throw new Response("Repository not found", { status: 404 });
  }

  return loadFilesystemData(request, userSession.token, repoRef);
}

export default function RepoScopedFilesystemRoute({ loaderData }: Route.ComponentProps) {
  return <FileSystemPage loaderData={loaderData} />;
}
