import { Form, Link, useActionData, useNavigation, useSearchParams } from "react-router";
import type { ActionFunction, LoaderFunction } from "react-router";
import { createUserSession, getUserSession, sanitizeRedirectTarget } from "~/utils/session.server";
import { API_URL, apiFetch } from "~/config";
import { fetchRepositoriesWithRetry } from "~/utils/repositoryRequests";
import { REPO_ID_KEY } from "~/utils/repositoryPreferences";

import {
  parseGithubLoginErrorCode,
  type GithubLoginErrorCode,
} from "../../../shared/models/githubLogin";

const githubErrors: Record<GithubLoginErrorCode, string> = {
  not_configured:
    "GitHub sign-in is not configured yet. You can still sign in with your username and password.",
  invalid_state:
    "This GitHub sign-in attempt expired or was already used. Please try again from this browser.",
  denied: "GitHub sign-in was cancelled. Try again when you’re ready.",
  provider_failed: "We couldn’t verify your GitHub account. Please try again.",
  account_unavailable: "This account is unavailable. Contact an administrator.",
  unavailable: "GitHub sign-in is temporarily unavailable. Please try again.",
};

type LoginResponse = {
  userId: string;
  username: string;
  role: string;
  token: string;
};

type LoginErrorResponse = {
  error?: string;
};

export const loader: LoaderFunction = async ({ request }) => {
  const userSession = await getUserSession(request);
  const requestUrl = new URL(request.url);
  const redirectTo = sanitizeRedirectTarget(requestUrl.searchParams.get("redirectTo"));

  // If user is already logged in, redirect to the requested destination
  if (userSession) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: redirectTo,
      },
    });
  }

  return null;
};

export const action: ActionFunction = async ({ request }) => {
  const formData = await request.formData();
  const requestUrl = new URL(request.url);
  const username = formData.get("username");
  const password = formData.get("password");
  const submittedRedirectTo = formData.get("redirectTo");
  const redirectTo = sanitizeRedirectTarget(
    typeof submittedRedirectTo === "string"
      ? submittedRedirectTo
      : requestUrl.searchParams.get("redirectTo"),
  );

  if (!username || !password) {
    return {
      error: "Username and password are required",
    };
  }

  if (typeof username !== "string" || typeof password !== "string") {
    return {
      error: "Username and password must be text values",
    };
  }

  try {
    const response = await apiFetch(`${API_URL}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username,
        password,
      }),
      request,
      retryCount: 2,
    });

    if (!response.ok) {
      const errorData = (await response.json()) as LoginErrorResponse;
      return {
        error: errorData.error || "Login failed",
      };
    }

    const userData = (await response.json()) as LoginResponse;

    // Fetch repositories and set default repository cookie
    let repositoryCookie = "";
    try {
      const repositories = await fetchRepositoriesWithRetry(userData.token, {
        request,
      });

      if (repositories.length > 0) {
        const sortedRepositories = [...repositories].sort(
          (a, b) => a.org.localeCompare(b.org) || a.name.localeCompare(b.name),
        );

        repositoryCookie = `${REPO_ID_KEY}=${encodeURIComponent(
          sortedRepositories[0].id,
        )}; Path=/; Max-Age=${60 * 60 * 24 * 365}`;
      }
    } catch (error) {
      console.error("Failed to fetch repositories during login:", error);
    }

    // Create user session and redirect to the requested destination
    return createUserSession(
      userData.userId,
      userData.username,
      userData.role,
      userData.token,
      redirectTo,
      repositoryCookie,
    );
  } catch (error) {
    console.error("Login error:", error);
    return {
      error: "Unable to connect to authentication service",
    };
  }
};

export default function Login() {
  const actionData = useActionData<typeof action>() as LoginErrorResponse | undefined;
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const isSubmitting = navigation.state === "submitting";
  const redirectTo = searchParams.get("redirectTo") ?? "";
  const githubErrorCode = searchParams.get("githubError");
  const githubError = githubErrorCode
    ? githubErrors[parseGithubLoginErrorCode(githubErrorCode)]
    : null;

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center">
      <div className="max-w-md w-full space-y-8 p-8">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            Sign in with password
          </h1>
        </div>

        {githubError && (
          <div
            role="alert"
            className="rounded-md border border-amber-700 bg-amber-950/30 px-4 py-3 text-sm text-amber-100"
          >
            {githubError}
          </div>
        )}

        <Form method="post" className="space-y-6">
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-gray-300 mb-2">
              Username
            </label>
            <input
              id="username"
              name="username"
              autoComplete="username"
              type="text"
              required
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter your username"
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-2">
              Password
            </label>
            <input
              id="password"
              name="password"
              autoComplete="current-password"
              type="password"
              required
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter your password"
              disabled={isSubmitting}
            />
          </div>

          {actionData?.error && (
            <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded-md">
              {actionData.error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Signing in..." : "Sign In"}
          </button>
        </Form>

        <div className="text-center space-y-2">
          <Link to="/" className="text-blue-400 hover:text-blue-300 text-sm">
            ← Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
