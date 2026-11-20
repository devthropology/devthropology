import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { startGithubLogin } from "~/utils/githubLogin.server";

export function action({ request }: ActionFunctionArgs) {
  return startGithubLogin(request);
}

export function loader(_args: LoaderFunctionArgs) {
  return new Response(null, {
    status: 302,
    headers: { Location: "/login", "Cache-Control": "no-store" },
  });
}
