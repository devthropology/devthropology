import {
  Form,
  Link,
  redirect,
  useNavigation,
  useRevalidator,
  useRouteLoaderData,
  useSearchParams,
} from "react-router";
import { ExternalLink, Plus } from "lucide-react";
import { useState } from "react";
import {
  connectionRequest,
  connectionErrorMessage,
  ConnectionWorkspacesSchema,
  githubRedirect,
  AvailableRepositoriesSchema,
  GithubConnectionsSchema,
} from "../utils/githubConnections.server";
import { z } from "zod";
import { API_URL, authenticatedFetch } from "../config";
import { requireUserSession } from "../utils/session.server";
import { buildRepoScopedPath } from "../utils/repositoryRoutes";
import type { loader as appLoader } from "./app";
import type { Route } from "./+types/app.settings";

const WorkspaceSchema = z.object({
  workspaceId: z.string(),
  name: z.string(),
  workspaceType: z.enum(["user", "demo", "system"]),
  repositoryIds: z.array(z.string()),
});

export async function loader({ request, url }: Route.LoaderArgs) {
  const user = await requireUserSession(request, url);
  const params = url.searchParams;
  let connectionError = params.has("githubConnectionError")
    ? "GitHub setup could not be completed. Check organization approval, use the GitHub account you signed in with, and try Add repositories again."
    : null;
  let manageableWorkspaces: z.infer<typeof ConnectionWorkspacesSchema> = [];
  let available: z.infer<typeof AvailableRepositoriesSchema> | null = null;
  let connections: z.infer<typeof GithubConnectionsSchema> = [];
  try {
    const [workspacesData, connectionsData] = await Promise.all([
      connectionRequest(request, user.token, "workspaces"),
      connectionRequest(request, user.token, "connections"),
    ]);
    manageableWorkspaces = ConnectionWorkspacesSchema.parse(workspacesData);
    connections = GithubConnectionsSchema.parse(connectionsData);
    const selected = connections.find(
      (connection) =>
        connection.workspaceId === params.get("workspaceId") &&
        connection.installationId === params.get("installationId"),
    );
    if (selected?.accountLogin) {
      const query = new URLSearchParams({
        workspaceId: selected.workspaceId,
        installationId: selected.installationId,
      });
      available = AvailableRepositoriesSchema.parse(
        await connectionRequest(request, user.token, `repositories?${query}`),
      );
    }
  } catch (error) {
    connectionError = connectionErrorMessage(error);
  }
  const connection = {
    manageableWorkspaces,
    available,
    connections,
    connectionError,
    added: params.get("added") === "1",
  };
  try {
    const response = await authenticatedFetch(
      `${API_URL}/api/workspaces?includeRepositories=1`,
      user.token,
      { request },
    );
    if (!response.ok) throw new Error(`Workspace request failed: ${response.status}`);
    const workspaces = z.array(WorkspaceSchema).parse(await response.json());
    return {
      user: { username: user.username, role: user.role },
      workspaces,
      workspacesError: false,
      ...connection,
    };
  } catch (error) {
    console.error("Failed to load settings workspaces:", error);
    return {
      user: { username: user.username, role: user.role },
      workspaces: [] as z.infer<typeof WorkspaceSchema>[],
      workspacesError: true,
      ...connection,
    };
  }
}

export async function action({ request, url }: Route.ActionArgs) {
  const user = await requireUserSession(request, url);
  if (request.headers.get("Origin") !== new URL(request.url).origin) {
    throw new Response("Invalid request origin", { status: 403 });
  }
  const form = await request.formData();
  try {
    if (form.get("intent") === "connect") {
      return githubRedirect(
        await connectionRequest(request, user.token, "start", {
          workspaceId: form.get("workspaceId"),
          installationId: form.get("installationId") ?? undefined,
        }),
      );
    }
    if (form.get("intent") === "add") {
      await connectionRequest(request, user.token, "repositories", {
        workspaceId: form.get("workspaceId"),
        installationId: form.get("installationId"),
        repositoryIds: form.getAll("repositoryId").map(Number),
      });
      return redirect("/app/settings?added=1");
    }
    return { error: "Unknown action." };
  } catch (error) {
    return { error: connectionErrorMessage(error) };
  }
}

export default function AccountSettings({ loaderData, actionData }: Route.ComponentProps) {
  const {
    user,
    workspaces,
    workspacesError,
    manageableWorkspaces,
    available,
    connections,
    connectionError,
    added,
  } = loaderData;
  const app = useRouteLoaderData<typeof appLoader>("routes/app");
  const revalidator = useRevalidator();
  const navigation = useNavigation();
  const [params] = useSearchParams();
  const busy = navigation.state !== "idle";
  const repositories = app?.repositories ?? [];
  const repositoriesError = !app || app.repositoriesError;
  const buttonClass =
    "rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 text-sm text-gray-200">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Settings</h1>
        <p className="mt-1 text-gray-400">Signed in as {user.username}</p>
      </header>

      {(workspacesError || repositoriesError) && (
        <div role="alert" className="rounded-lg border border-amber-700 bg-amber-950/30 p-4">
          <p>Some workspaces or repositories could not be loaded.</p>
          <button
            type="button"
            className="mt-2 text-blue-400 disabled:opacity-50"
            disabled={revalidator.state === "loading"}
            onClick={() => {
              void revalidator.revalidate();
            }}
          >
            {revalidator.state === "loading" ? "Retrying…" : "Retry"}
          </button>
        </div>
      )}
      {(actionData?.error || connectionError) && (
        <p role="alert" className="text-amber-300">
          {actionData?.error || connectionError}
        </p>
      )}
      {added && (
        <p role="status" className="text-green-400">
          Repositories added.
        </p>
      )}

      {!workspacesError && workspaces.length === 0 && (
        <p className="text-gray-400">
          {user.role === "demo"
            ? "Demo accounts cannot manage workspaces."
            : "No workspaces yet. Contact an administrator to get started."}
        </p>
      )}
      {workspaces.map((workspace) => {
        const workspaceConnections = connections.filter(
          (c) => c.workspaceId === workspace.workspaceId,
        );
        const canManage =
          user.role !== "demo" &&
          manageableWorkspaces.some((w) => w.workspaceId === workspace.workspaceId);
        const expanded = params.get("workspaceId") === workspace.workspaceId;
        const workspaceRepositories = repositories.filter((repo) =>
          workspace.repositoryIds.includes(repo.id),
        );
        const pickerUrl = new URLSearchParams({ workspaceId: workspace.workspaceId });
        if (workspaceConnections.length === 1 && workspaceConnections[0].accountLogin) {
          pickerUrl.set("installationId", workspaceConnections[0].installationId);
        }
        return (
          <section
            key={workspace.workspaceId}
            className="rounded-lg border border-gray-700 bg-white/5 p-6"
            aria-labelledby={`workspace-${workspace.workspaceId}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2
                id={`workspace-${workspace.workspaceId}`}
                className="min-w-0 break-words text-lg font-semibold text-white"
              >
                {workspace.name}
              </h2>
              {canManage && !expanded && (
                <Link
                  to={`/app/settings?${pickerUrl}`}
                  className="inline-flex items-center gap-1 text-blue-400 hover:underline"
                >
                  <Plus size={16} /> Add repositories
                </Link>
              )}
            </div>
            {repositoriesError ? (
              <p className="mt-3 text-gray-400">Unable to load repositories.</p>
            ) : workspaceRepositories.length === 0 ? (
              <p className="mt-3 text-gray-400">No repositories yet.</p>
            ) : (
              <ul className="mt-3 space-y-2 border-l border-gray-700 pl-4">
                {workspaceRepositories.map((repo) => (
                  <li key={repo.id}>
                    <Link
                      className="break-words text-blue-400 hover:underline"
                      to={buildRepoScopedPath(repo.id)}
                    >
                      {repo.org}/{repo.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {canManage && expanded && (
              <div className="mt-4 space-y-3 border-t border-gray-700 pt-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-medium text-white">Add repositories</h3>
                  <Link to="/app/settings" className="text-gray-400 hover:text-white">
                    Cancel
                  </Link>
                </div>
                {workspaceConnections.map((connection) =>
                  connection.accountLogin ? (
                    workspaceConnections.length > 1 && (
                      <Link
                        key={connection.installationId}
                        className={`mr-3 inline-block hover:underline ${available?.installationId === connection.installationId ? "font-medium text-white" : "text-blue-400"}`}
                        to={`/app/settings?${new URLSearchParams({ workspaceId: workspace.workspaceId, installationId: connection.installationId })}`}
                      >
                        {connection.accountLogin}
                      </Link>
                    )
                  ) : (
                    <Form key={connection.installationId} method="post">
                      <input type="hidden" name="intent" value="connect" />
                      <input type="hidden" name="workspaceId" value={workspace.workspaceId} />
                      <input
                        type="hidden"
                        name="installationId"
                        value={connection.installationId}
                      />
                      <button disabled={busy} className={buttonClass}>
                        Reconnect GitHub
                      </button>
                    </Form>
                  ),
                )}
                {available?.workspaceId === workspace.workspaceId && (
                  <RepositoryPicker
                    key={`${available.workspaceId}:${available.installationId}:${available.addedRepositoryIds.join(",")}`}
                    available={available}
                    busy={busy}
                    buttonClass={buttonClass}
                  />
                )}
                <Form method="post" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <input type="hidden" name="intent" value="connect" />
                  <input type="hidden" name="workspaceId" value={workspace.workspaceId} />
                  {workspaceConnections.length > 0 && (
                    <span className="text-gray-400">Missing a repository?</span>
                  )}
                  <button
                    disabled={busy}
                    className="inline-flex items-center gap-1 text-blue-400 hover:underline disabled:opacity-50"
                  >
                    {workspaceConnections.length > 0 ? "Grant access on GitHub" : "Connect GitHub"}
                    <ExternalLink size={14} />
                  </button>
                </Form>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function RepositoryPicker({
  available,
  busy,
  buttonClass,
}: {
  available: z.infer<typeof AvailableRepositoriesSchema>;
  busy: boolean;
  buttonClass: string;
}) {
  const addedIds = new Set(available.addedRepositoryIds);
  const repositories = available.repositories.filter((repo) => !addedIds.has(repo.id));
  const [selected, setSelected] = useState<number[]>([]);
  if (repositories.length === 0) {
    return <p className="text-gray-400">No new repositories available.</p>;
  }
  return (
    <Form method="post" className="space-y-3">
      <input type="hidden" name="intent" value="add" />
      <input type="hidden" name="workspaceId" value={available.workspaceId} />
      <input type="hidden" name="installationId" value={available.installationId} />
      <div className="max-h-64 overflow-y-auto rounded bg-white/5">
        {repositories.map((repo) => (
          <label key={repo.id} className="flex items-center gap-3 px-3 py-2">
            <input
              type="checkbox"
              name="repositoryId"
              value={repo.id}
              checked={selected.includes(repo.id)}
              disabled={busy || (selected.length >= 100 && !selected.includes(repo.id))}
              onChange={(event) =>
                setSelected(
                  event.target.checked
                    ? [...selected, repo.id]
                    : selected.filter((id) => id !== repo.id),
                )
              }
            />
            <span className="min-w-0 break-words">
              {repo.org}/{repo.name}
            </span>
            <span className="ml-auto text-xs text-gray-400">
              {repo.private ? "Private" : "Public"}
            </span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={busy || selected.length === 0} className={buttonClass}>
          {busy ? "Adding…" : `Add selected${selected.length ? ` (${selected.length})` : ""}`}
        </button>
        <span className="text-xs text-gray-400">Adding doesn’t start a sync.</span>
      </div>
    </Form>
  );
}
