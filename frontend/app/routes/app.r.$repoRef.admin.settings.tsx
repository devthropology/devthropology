import { redirect } from "react-router";
import { requireUserSession } from "../utils/session.server";
import type { Route } from "./+types/app.r.$repoRef.admin.settings";

export async function loader({ request, url }: Route.LoaderArgs) {
  await requireUserSession(request, url);
  return redirect("/app/settings");
}
