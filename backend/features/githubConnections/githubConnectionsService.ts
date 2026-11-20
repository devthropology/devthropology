import { readFile } from "node:fs/promises";
import { env } from "node:process";
import { createSign } from "node:crypto";
import { Buffer } from "node:buffer";
import { z } from "zod";
import type { AuthUser } from "../../models/auth.ts";
import {
  randomSecret,
  sha256Base64Url,
} from "../githubLogin/githubLoginService.ts";
import {
  type AvailableRepository,
  ConnectionError,
  GithubConnectionsRepository,
} from "./githubConnectionsRepository.ts";

const GithubRepoSchema = z.object({
  id: z.number().int().positive().safe(),
  name: z.string().min(1),
  owner: z.object({ login: z.string().min(1) }),
  private: z.boolean(),
});
const TokenSchema = z.object({ access_token: z.string().min(1) });

export interface GithubConnectionsConfig {
  appId: string;
  slug: string;
  keyPath?: string;
  privateKeyBase64?: string;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

export class GithubConnectionsConfigurationError extends Error {
  constructor() {
    super("GitHub repository connection is not configured on the server.");
  }
}

type ConnectionRepository = Pick<
  GithubConnectionsRepository,
  | "ownedWorkspaces"
  | "connections"
  | "requireOwner"
  | "identity"
  | "connection"
  | "saveAttempt"
  | "consumeAttempt"
  | "saveConnection"
  | "attach"
  | "addedRepositoryIds"
>;

export function getGithubConnectionsConfig(): GithubConnectionsConfig {
  const appId = env.GITHUB_APP_ID;
  const slug = env.GITHUB_APP_SLUG;
  const keyPath = env.GITHUB_APP_PRIVATE_KEY_PATH;
  const privateKeyBase64 = env.GITHUB_APP_PRIVATE_KEY_BASE64;
  const clientId = env.GITHUB_APP_CLIENT_ID;
  const clientSecret = env.GITHUB_APP_CLIENT_SECRET;
  const loginCallback = env.GITHUB_APP_CALLBACK_URL;
  if (
    !appId ||
    !/^\d+$/.test(appId) ||
    !slug ||
    !/^[a-zA-Z0-9-]+$/.test(slug) ||
    (!keyPath && !privateKeyBase64) ||
    !clientId ||
    !clientSecret ||
    !loginCallback
  ) {
    throw new GithubConnectionsConfigurationError();
  }
  // Both GitHub's Setup URL and an additional OAuth callback URL use this URL.
  let callbackUrl: string;
  try {
    callbackUrl = new URL("/app/settings/github", loginCallback).href;
  } catch {
    throw new GithubConnectionsConfigurationError();
  }
  return {
    appId,
    slug,
    keyPath,
    privateKeyBase64,
    clientId,
    clientSecret,
    callbackUrl,
  };
}

async function github(
  path: string,
  token: string,
  fetcher: typeof fetch,
  method = "GET",
  body?: { repository_ids: number[] },
): Promise<unknown> {
  const response = await fetcher(`https://api.github.com${path}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "Devthropology",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
  if (!response.ok) {
    console.error("[github-connections] GitHub API request failed", {
      operation: path.startsWith("/app/")
        ? "installation_token"
        : path === "/user"
          ? "identity"
          : "repositories",
      status: response.status,
    });
    throw new ConnectionError(
      "GitHub access could not be verified. Check installation approval and repository permissions, then try again.",
    );
  }
  return await response.json();
}

async function repositories(
  path: string,
  token: string,
  fetcher: typeof fetch,
): Promise<AvailableRepository[]> {
  const result: AvailableRepository[] = [];
  for (let page = 1; page <= 100; page++) {
    const data = z
      .object({ repositories: z.array(GithubRepoSchema) })
      .parse(await github(`${path}?per_page=100&page=${page}`, token, fetcher));
    result.push(
      ...data.repositories.map((r) => ({
        id: r.id,
        org: r.owner.login,
        name: r.name,
        private: r.private,
      })),
    );
    if (data.repositories.length < 100) return result;
  }
  throw new ConnectionError(
    "This installation has too many repositories. Limit its repository access on GitHub and try again.",
  );
}

async function appToken(
  settings: GithubConnectionsConfig,
  readKey: (path: string) => Promise<string>,
) {
  const encode = (data: unknown) =>
    Buffer.from(JSON.stringify(data)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iat: now - 60,
    exp: now + 540,
    iss: settings.appId,
  })}`;
  // Prefer the file when configured; a broken path must not silently fall back.
  let privateKey: string;
  if (settings.keyPath) {
    privateKey = await readKey(settings.keyPath);
  } else if (settings.privateKeyBase64) {
    try {
      privateKey = atob(settings.privateKeyBase64);
    } catch {
      throw new GithubConnectionsConfigurationError();
    }
  } else {
    throw new GithubConnectionsConfigurationError();
  }
  // Node crypto accepts GitHub's PKCS#1 PEM as well as PKCS#8 keys.
  const signature = createSign("RSA-SHA256")
    .update(payload)
    .sign(privateKey, "base64url");
  return `${payload}.${signature}`;
}

async function installationToken(
  installationId: string,
  settings: GithubConnectionsConfig,
  fetcher: typeof fetch,
  readKey: (path: string) => Promise<string>,
) {
  const response = await requestGithubInstallationToken(
    installationId,
    settings,
    fetcher,
    readKey,
  );
  return z.object({ token: z.string().min(1) }).parse(response).token;
}

/** Shared minting operation; sync additionally validates and retains expiry. */
export async function requestGithubInstallationToken(
  installationId: string,
  settings: GithubConnectionsConfig,
  fetcher: typeof fetch = fetch,
  readKey: (path: string) => Promise<string> = (path: string) =>
    readFile(path, "utf8"),
  repositoryId?: number,
): Promise<unknown> {
  return await github(
    `/app/installations/${installationId}/access_tokens`,
    await appToken(settings, readKey),
    fetcher,
    "POST",
    repositoryId === undefined ? undefined : { repository_ids: [repositoryId] },
  );
}

export class GithubConnectionsService {
  constructor(
    private readonly repository: ConnectionRepository,
    // Resolve configuration lazily: listing workspaces/connections must still work
    // when GitHub is unconfigured. Tests can supply a config provider without env.
    private readonly getConfig: () => GithubConnectionsConfig = getGithubConnectionsConfig,
    private readonly fetcher: typeof fetch = fetch,
    private readonly readKey: (path: string) => Promise<string> = (
      path: string,
    ) => readFile(path, "utf8"),
  ) {}

  async listWorkspaces(user: AuthUser) {
    return await this.repository.ownedWorkspaces(user);
  }

  async listConnections(user: AuthUser) {
    return await this.repository.connections(user);
  }

  private async authorize(
    user: AuthUser,
    workspaceId: string,
    installationId: string,
  ) {
    const settings = this.getConfig();
    const state = randomSecret();
    const verifier = randomSecret();
    await this.repository.saveAttempt(user, await sha256Base64Url(state), {
      workspaceId,
      installationId,
      verifier,
    });
    const params = new URLSearchParams({
      client_id: settings.clientId,
      redirect_uri: settings.callbackUrl,
      state,
      code_challenge: await sha256Base64Url(verifier),
      code_challenge_method: "S256",
    });
    return {
      redirectUrl: `https://github.com/login/oauth/authorize?${params}`,
    };
  }

  async start(user: AuthUser, workspaceId: string, installationId?: string) {
    const settings = this.getConfig();
    await this.repository.requireOwner(user, workspaceId);
    await this.repository.identity(user);
    if (installationId) {
      await this.repository.connection(user, workspaceId, installationId);
      return await this.authorize(user, workspaceId, installationId);
    }
    const state = randomSecret();
    await this.repository.saveAttempt(user, await sha256Base64Url(state), {
      workspaceId,
      verifier: randomSecret(),
      installationId: null,
    });
    return {
      redirectUrl: `https://github.com/apps/${settings.slug}/installations/new?state=${state}`,
    };
  }

  async callback(
    user: AuthUser,
    input: {
      state: string;
      installationId?: string;
      code?: string;
      setupAction?: string;
    },
  ) {
    const settings = this.getConfig();
    const attempt = await this.repository.consumeAttempt(
      user,
      await sha256Base64Url(input.state),
    );
    if (!attempt.installationId) {
      if (input.setupAction === "request") {
        throw new ConnectionError(
          "Organization approval is pending. Once approved, click Add repositories again.",
        );
      }
      if (!input.installationId) {
        throw new ConnectionError(
          "No installation selected. Please add repositories again.",
        );
      }
      // An installation callback is not authorization proof. Obtain a fresh user
      // token, bound to this attempt, then verify identity and repository access.
      return await this.authorize(
        user,
        attempt.workspaceId,
        input.installationId,
      );
    }
    if (!input.code) {
      throw new ConnectionError(
        "GitHub authorization was cancelled. Please try again.",
      );
    }
    const response = await this.fetcher(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: settings.clientId,
          client_secret: settings.clientSecret,
          redirect_uri: settings.callbackUrl,
          code: input.code,
          code_verifier: attempt.verifier,
        }),
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      },
    );
    if (!response.ok) {
      throw new ConnectionError(
        "GitHub authorization failed. Please try again.",
      );
    }
    const token = TokenSchema.parse(await response.json()).access_token;
    const identity = z
      .object({ id: z.number().int().positive().safe() })
      .parse(await github("/user", token, this.fetcher));
    if (String(identity.id) !== (await this.repository.identity(user))) {
      throw new ConnectionError(
        "Use the same GitHub account you used to sign in to Devthropology.",
      );
    }
    // A connection grants workspace-level installation access, not merely the
    // user's current repository subset. Require the account owner / org admin.
    const installation = z
      .object({
        account: z.object({
          id: z.number().int().positive().safe(),
          login: z.string().min(1),
          type: z.enum(["User", "Organization"]),
        }),
        suspended_at: z.string().nullable(),
      })
      .parse(
        await github(
          `/app/installations/${attempt.installationId}`,
          await appToken(settings, this.readKey),
          this.fetcher,
        ),
      );
    if (installation.suspended_at) {
      throw new ConnectionError("This GitHub installation is suspended.");
    }
    const account = installation.account;
    if (account.type === "User") {
      if (account.id !== identity.id) {
        throw new ConnectionError(
          "Only the GitHub account owner can connect this installation.",
        );
      }
    } else {
      const membership = z
        .object({ state: z.string(), role: z.string() })
        .parse(
          await github(
            `/user/memberships/orgs/${encodeURIComponent(account.login)}`,
            token,
            this.fetcher,
          ),
        );
      if (membership.state !== "active" || membership.role !== "admin") {
        throw new ConnectionError(
          "An organization owner must connect this GitHub installation.",
        );
      }
    }
    await this.repository.saveConnection(
      user,
      attempt.workspaceId,
      attempt.installationId,
      account.login,
    );
    // User tokens are never persisted or returned to the browser.
    return {
      workspaceId: attempt.workspaceId,
      installationId: attempt.installationId,
    };
  }

  async available(user: AuthUser, workspaceId: string, installationId: string) {
    const connection = await this.repository.connection(
      user,
      workspaceId,
      installationId,
    );
    if (!connection.accountLogin) {
      throw new ConnectionError(
        "Reconnect GitHub once to enable the simpler repository picker.",
      );
    }
    const token = await installationToken(
      installationId,
      this.getConfig(),
      this.fetcher,
      this.readKey,
    );
    return {
      ...connection,
      addedRepositoryIds: await this.repository.addedRepositoryIds(workspaceId),
      repositories: await repositories(
        "/installation/repositories",
        token,
        this.fetcher,
      ),
    };
  }

  async add(
    user: AuthUser,
    workspaceId: string,
    installationId: string,
    ids: number[],
  ) {
    // Never trust metadata or repository IDs from the browser. Query current
    // installation access on every add, using the persistent workspace connection.
    const available = await this.available(user, workspaceId, installationId);
    const selected = available.repositories.filter((r) => ids.includes(r.id));
    if (selected.length !== new Set(ids).size) {
      throw new ConnectionError(
        "Repository access changed. Please add repositories again.",
      );
    }
    await this.repository.requireOwner(user, workspaceId);
    await this.repository.attach(user, available, selected);
    return { added: selected.length };
  }
}
