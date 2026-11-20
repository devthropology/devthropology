import { redirect, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { requireUserSession } from "../utils/session.server";
import {
  connectionRequest,
  githubRedirect,
  GithubConnectionSchema,
  logConnectionFailure,
} from "../utils/githubConnections.server";

export async function loader({ request, url }: LoaderFunctionArgs) {
  const user = await requireUserSession(request, url);
  const params = url.searchParams;
  try {
    const data = await connectionRequest(request, user.token, "callback", {
      state: params.get("state"),
      installationId: params.get("installation_id") ?? undefined,
      setupAction: params.get("setup_action") ?? undefined,
      code: params.get("code") ?? undefined,
    });
    if (z.object({ redirectUrl: z.string() }).safeParse(data).success) return githubRedirect(data);
    const connection = GithubConnectionSchema.omit({ accountLogin: true }).parse(data);
    const query = new URLSearchParams(connection);
    return redirect(`/app/settings?${query}`, {
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    logConnectionFailure("callback", error);
    return redirect("/app/settings?githubConnectionError=1", {
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  }
}
