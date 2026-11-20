import { z } from "zod";
import { API_URL, authenticatedFetch } from "../config";

// Existing seeded workspace IDs are PostgreSQL UUIDs without RFC version bits.
const WorkspaceIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export const ConnectionWorkspacesSchema = z.array(
  z.object({ workspaceId: WorkspaceIdSchema, name: z.string() }),
);
export const GithubConnectionSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  installationId: z.string().regex(/^[1-9][0-9]{0,18}$/),
  accountLogin: z.string().nullable(),
});
export const GithubConnectionsSchema = z.array(GithubConnectionSchema);
export const AvailableRepositoriesSchema = GithubConnectionSchema.extend({
  addedRepositoryIds: z.array(z.number()),
  repositories: z.array(
    z.object({
      id: z.number(),
      org: z.string(),
      name: z.string(),
      private: z.boolean(),
    }),
  ),
});

export class ConnectionRequestError extends Error {}

export function logConnectionFailure(stage: string, error: unknown) {
  // Do not log errors wholesale: they can contain response data, codes, or URLs.
  console.error("[github-connections]", {
    stage,
    kind:
      error instanceof z.ZodError
        ? "invalid_response"
        : error instanceof ConnectionRequestError
          ? "backend_error"
          : "unexpected_error",
    ...(error instanceof z.ZodError
      ? {
          issues: error.issues.map((issue) => ({ code: issue.code, path: issue.path.join(".") })),
        }
      : {}),
  });
}

export function connectionErrorMessage(error: unknown) {
  logConnectionFailure("settings", error);
  return error instanceof ConnectionRequestError
    ? error.message
    : "Repository setup is unavailable. Please try again.";
}

export async function connectionRequest(
  request: Request,
  token: string,
  path: string,
  body?: unknown,
) {
  const response = await authenticatedFetch(`${API_URL}/api/github-connections/${path}`, token, {
    request,
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    timeoutMs: 120_000,
    retryCount: 0,
    // Workers supports manual, but not error; do not follow redirects with bearer tokens.
    redirect: "manual",
  });
  if (response.status >= 300 && response.status < 400) {
    throw new ConnectionRequestError("Repository setup is unavailable. Please try again.");
  }
  const data: unknown = await response.json();
  if (!response.ok) {
    console.error("[github-connections] backend request failed", {
      operation: path.split(/[/?]/)[0],
      status: response.status,
    });
    const error = z.object({ error: z.string() }).safeParse(data);
    throw new ConnectionRequestError(
      error.success ? error.data.error : "Repository setup is unavailable. Please try again.",
    );
  }
  return data;
}

export function githubRedirect(data: unknown) {
  const { redirectUrl } = z.object({ redirectUrl: z.string().url() }).parse(data);
  const url = new URL(redirectUrl);
  if (url.origin !== "https://github.com" || url.username || url.password)
    throw new Error("Invalid GitHub redirect.");
  return new Response(null, {
    status: 303,
    headers: {
      Location: url.href,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
