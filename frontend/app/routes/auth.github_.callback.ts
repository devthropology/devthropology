import type { LoaderFunctionArgs } from "react-router";
import { completeGithubLogin } from "~/utils/githubLogin.server";

export function loader({ request }: LoaderFunctionArgs) {
  return completeGithubLogin(request);
}
