import { Link, useRouteError } from "react-router";
import { getUserSession } from "~/utils/session.server";

export async function loader({ request }: { request: Request }) {
  const requestUrl = new URL(request.url);
  const userSession = await getUserSession(request);

  console.warn("Rejected unknown public route", {
    pathname: requestUrl.pathname,
    search: requestUrl.search,
    userId: userSession?.userId ?? null,
    username: userSession?.username ?? null,
  });

  throw new Response("Not Found", { status: 404, statusText: "Not Found" });
}

export default function UnknownPublicRoute() {
  return null;
}

export function ErrorBoundary() {
  const error = useRouteError();

  const message =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: number }).status === 404
      ? "This page does not exist."
      : "An unexpected error occurred.";

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-6">
      <div className="max-w-md text-center space-y-3">
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="text-sm text-slate-300">{message}</p>
        <Link
          to="/"
          className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
