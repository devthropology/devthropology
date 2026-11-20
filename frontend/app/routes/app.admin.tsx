import AdminCenter from "../pages/adminSettings";
import { requireUserSession } from "../utils/session.server";
import type { Route } from "./+types/app.admin";

export async function loader({ request, url }: Route.LoaderArgs) {
  const user = await requireUserSession(request, url);
  if (user.role !== "superuser") {
    throw new Response("Superuser role required", { status: 403 });
  }
  return { user };
}

export default AdminCenter;
