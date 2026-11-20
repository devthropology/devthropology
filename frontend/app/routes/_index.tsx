import { Link } from "react-router";
import { GithubSignInButton } from "~/components/GithubSignInButton";
import { getUserSession } from "~/utils/session.server";
import type { LoaderFunction } from "react-router";

export const loader: LoaderFunction = async ({ request }) => {
  const userSession = await getUserSession(request);

  // If user is already logged in, redirect to app
  if (userSession) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/app",
      },
    });
  }

  return null;
};

export default function Index() {
  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center">
      <div className="max-w-md w-full space-y-8 p-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-white mb-2">Devthropology</h1>
          <p className="text-sm text-gray-400">
            Developer activity, contributor insights, reviewer metrics.
          </p>
        </div>

        <div className="space-y-3">
          <Link
            to="/demo/v2"
            className="w-full flex justify-center py-3 px-4 border border-gray-600 rounded-md shadow-sm text-sm font-medium text-white bg-gray-800 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Try demo
          </Link>
          <GithubSignInButton />

          <Link
            to="/login"
            className="w-full flex justify-center py-3 px-4 border border-gray-600 rounded-md shadow-sm text-sm font-medium text-white bg-gray-800 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Sign in with password
          </Link>
        </div>
      </div>
    </div>
  );
}
