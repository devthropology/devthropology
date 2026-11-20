import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { AuthUser } from "../../models/auth.ts";
import type { GithubCredentialsProvider } from "../../models/githubCredentials.ts";
import type { SqlClient } from "../../repository/sqlClient.ts";
import {
  ConnectionError,
  GithubConnectionsRepository,
} from "../githubConnections/githubConnectionsRepository.ts";
import {
  getGithubConnectionsConfig,
  type GithubConnectionsConfig,
  requestGithubInstallationToken,
} from "../githubConnections/githubConnectionsService.ts";

const InstallationTokenSchema = z.object({
  token: z.string().min(1),
  expires_at: z.string().datetime({ offset: true }),
});

interface InstallationCredentialsDependencies {
  getConfig?: () => GithubConnectionsConfig;
  fetcher?: typeof fetch;
  readKey?: (path: string) => Promise<string>;
  now?: () => number;
}

export class GithubInstallationCredentials implements GithubCredentialsProvider {
  private cached?: { token: string; expiresAt: number };
  private refreshing?: Promise<void>;
  private readonly now: () => number;

  constructor(
    private readonly installationId: string,
    private readonly githubRepositoryId: number,
    private readonly dependencies: InstallationCredentialsDependencies = {},
  ) {
    this.now = dependencies.now ?? Date.now;
  }

  async getAuthorizationHeader(): Promise<string> {
    if (!this.cached || this.cached.expiresAt <= this.now() + 60_000) {
      // Share an in-flight renewal across concurrent requests in this run.
      const refreshing = (this.refreshing ??= this.refresh());
      try {
        await refreshing;
      } finally {
        if (this.refreshing === refreshing) this.refreshing = undefined;
      }
    }
    if (!this.cached) throw new ConnectionError("GitHub token is unavailable.");
    return `Bearer ${this.cached.token}`;
  }

  private async refresh(): Promise<void> {
    const response = await requestGithubInstallationToken(
      this.installationId,
      (this.dependencies.getConfig ?? getGithubConnectionsConfig)(),
      this.dependencies.fetcher ?? fetch,
      this.dependencies.readKey ?? ((path: string) => readFile(path, "utf8")),
      this.githubRepositoryId,
    );
    const parsed = InstallationTokenSchema.safeParse(response);
    // Do not include the token-bearing response in validation errors/logs.
    if (!parsed.success) {
      throw new ConnectionError(
        "GitHub returned invalid installation credentials.",
      );
    }
    const expiresAt = Date.parse(parsed.data.expires_at);
    if (expiresAt <= this.now() + 60_000) {
      throw new ConnectionError(
        "GitHub returned expired installation credentials.",
      );
    }
    this.cached = { token: parsed.data.token, expiresAt };
  }
}

/**
 * Caller must check repository access, especially for the undefined/legacy path.
 * Installation credentials additionally require an owned workspace connection;
 * ownedWorkspaces() supplies the superuser override. Unauthorized connections fail closed.
 */
export async function resolveGithubSyncCredentials(
  sql: SqlClient,
  user: AuthUser,
  repositoryId: number,
): Promise<GithubCredentialsProvider | undefined> {
  const connections = await sql<
    {
      workspaceId: string;
      installationId: string;
      accountLogin: string | null;
      githubRepositoryId: string | null;
    }[]
  >`
    SELECT g.workspace_id AS "workspaceId",
      g.installation_id::text AS "installationId",
      i.account_login AS "accountLogin",
      r.github_repository_id::text AS "githubRepositoryId"
    FROM workspace_github_repository g
    JOIN workspace_github_installation i
      ON i.workspace_id = g.workspace_id AND i.installation_id = g.installation_id
    JOIN repository r ON r.repository_id = g.repository_id
    WHERE g.repository_id = ${repositoryId}
    ORDER BY g.workspace_id, g.installation_id
  `;
  if (connections.length === 0) return undefined;

  const owned = await new GithubConnectionsRepository(sql).ownedWorkspaces(
    user,
  );
  const connection = connections.find(
    (c) => c.accountLogin && owned.some((w) => w.workspaceId === c.workspaceId),
  );
  if (!connection) {
    throw new ConnectionError(
      "Sync requires a verified GitHub connection in a workspace you own. Ask a workspace owner to sync or reconnect GitHub.",
    );
  }
  const githubRepositoryId = z.coerce
    .number()
    .int()
    .positive()
    .safe()
    .safeParse(connection.githubRepositoryId);
  if (!githubRepositoryId.success) {
    console.error("Invalid GitHub repository identity for sync", {
      repositoryId,
      workspaceId: connection.workspaceId,
      githubRepositoryId: connection.githubRepositoryId,
    });
    throw new Error("Saved GitHub repository identity is invalid.");
  }
  return new GithubInstallationCredentials(
    connection.installationId,
    githubRepositoryId.data,
  );
}
