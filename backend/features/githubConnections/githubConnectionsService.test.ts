import { test } from "vitest";
import {
  deepStrictEqual as assertEquals,
  ok as assert,
  rejects,
  rejects as assertRejects,
  strictEqual,
} from "node:assert/strict";

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  GithubConnectionsConfigurationError,
  GithubConnectionsService,
  requestGithubInstallationToken,
} from "./githubConnectionsService.ts";
import {
  type AvailableRepository,
  type ConnectionAttempt,
  ConnectionError,
  type GithubConnection,
} from "./githubConnectionsRepository.ts";

const user = { userId: "user-id", username: "octocat", role: "user" };
const workspaceId = "workspace-id";
const installationId = "42";
const config = {
  appId: "123",
  slug: "test-app",
  keyPath: "injected-key.pem",
  clientId: "client",
  clientSecret: "client-secret",
  callbackUrl: "https://frontend.test/app/settings/github",
};
// Ephemeral key: exercise actual PEM signing, not a stubbed JWT implementation.
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = keys.privateKey.export({ type: "pkcs1", format: "pem" }).toString();
test("installation signing reads PEM through the default filesystem reader", async () => {
  const directory = await mkdtemp(join(tmpdir(), "github-signing-"));
  const keyPath = join(directory, "private-key.pem");
  let calls = 0;
  const fetcher: typeof fetch = (_input, init) => {
    calls++;
    const token = new Headers(init?.headers).get("Authorization")!.slice(7);
    const [header, payload, signature] = token.split(".");
    strictEqual(
      verify(
        "RSA-SHA256",
        Buffer.from(`${header}.${payload}`),
        keys.publicKey,
        Buffer.from(signature, "base64url"),
      ),
      true,
    );
    return Promise.resolve(Response.json({ token: "installation-token" }));
  };
  try {
    await writeFile(keyPath, pem, { encoding: "utf8", mode: 0o600 });
    await requestGithubInstallationToken(
      installationId,
      { ...config, keyPath },
      fetcher,
    );
    strictEqual(calls, 1);
    await rm(keyPath);
    await rejects(
      requestGithubInstallationToken(
        installationId,
        {
          ...config,
          keyPath,
          privateKeyBase64: Buffer.from(pem).toString("base64"),
        },
        fetcher,
      ),
      { code: "ENOENT" },
    );
    strictEqual(calls, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("installation signing supports base64 PEM without reading a file", async () => {
  const fetcher: typeof fetch = (_input, init) => {
    const token = new Headers(init?.headers).get("Authorization")!.slice(7);
    const [header, payload, signature] = token.split(".");
    assert(
      verify(
        "RSA-SHA256",
        Buffer.from(`${header}.${payload}`),
        keys.publicKey,
        Buffer.from(signature, "base64url"),
      ),
    );
    return Promise.resolve(Response.json({ token: "installation-token" }));
  };
  assertEquals(
    await requestGithubInstallationToken(
      installationId,
      {
        ...config,
        keyPath: undefined,
        privateKeyBase64: Buffer.from(pem).toString("base64"),
      },
      fetcher,
      () => {
        throw new Error("Must not read a file");
      },
    ),
    { token: "installation-token" },
  );
});

test("installation signing prefers the path and does not fall back on read errors", async () => {
  await assertRejects(
    () =>
      requestGithubInstallationToken(
        installationId,
        {
          ...config,
          privateKeyBase64: Buffer.from(pem).toString("base64"),
        },
        fetch,
        (path) => {
          assertEquals(path, config.keyPath);
          throw new Error("File unavailable");
        },
      ),
    (error: unknown) =>
      error instanceof Error && error.message.includes("File unavailable"),
  );
});

test("installation signing rejects missing or malformed base64 configuration", async () => {
  for (const privateKeyBase64 of [undefined, "not!base64"]) {
    await assertRejects(
      () =>
        requestGithubInstallationToken(installationId, {
          ...config,
          keyPath: undefined,
          privateKeyBase64,
        }),
      GithubConnectionsConfigurationError,
    );
  }
});

const first: AvailableRepository = {
  id: 100,
  org: "octocat",
  name: "one",
  private: true,
};
const second: AvailableRepository = { ...first, id: 200, name: "two" };

function fixture(
  options: {
    identityId?: number;
    accountId?: number;
    organization?: boolean;
    membershipRole?: string;
    suspended?: boolean;
  } = {},
) {
  const attempts = new Map<string, ConnectionAttempt>();
  const writes: unknown[] = [];
  const returned: unknown[] = [];
  const jwtTokens: string[] = [];
  const calls: string[] = [];
  const attached: AvailableRepository[][] = [];
  const savedConnections: GithubConnection[] = [];
  let available = [first, second];
  let verifier: string | undefined;
  const repository: ConstructorParameters<typeof GithubConnectionsService>[0] =
    {
      ownedWorkspaces: () =>
        Promise.resolve([{ workspaceId, name: "Personal" }]),
      connections: () => Promise.resolve(savedConnections),
      addedRepositoryIds: () =>
        Promise.resolve(
          attached.flatMap((repos) => repos.map((repo) => repo.id)),
        ),
      requireOwner: () => Promise.resolve(),
      identity: () => Promise.resolve("7"),
      connection: () => {
        assert(
          savedConnections[0],
          "Connection must be saved before listing repositories",
        );
        return Promise.resolve(savedConnections[0]);
      },
      saveAttempt: (actor, hash, attempt) => {
        writes.push([actor, hash, attempt]);
        attempts.set(hash, attempt);
        if (attempt.installationId) verifier = attempt.verifier;
        return Promise.resolve();
      },
      consumeAttempt: (_actor, hash) => {
        const attempt = attempts.get(hash);
        assert(attempt, "Callback must reference the issued state");
        attempts.delete(hash);
        return Promise.resolve(attempt);
      },
      saveConnection: (actor, workspace, installation, accountLogin) => {
        writes.push([actor, workspace, installation, accountLogin]);
        savedConnections.push({
          workspaceId: workspace,
          installationId: installation,
          accountLogin,
        });
        return Promise.resolve();
      },
      attach: (actor, connection, repos) => {
        writes.push([actor, connection, repos]);
        attached.push(repos);
        return Promise.resolve();
      },
    };
  const fetcher: typeof fetch = (input, init) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    assertEquals(init?.redirect, "error");
    assert(init?.signal, "Provider requests must have a timeout");
    const authorization = new Headers(init.headers).get("Authorization");
    if (url.pathname === "/login/oauth/access_token") {
      assertEquals(url.origin, "https://github.com");
      assertEquals(init.method, "POST");
      const body = init.body as URLSearchParams;
      assertEquals(body.get("code_verifier"), verifier);
      assertEquals(body.get("redirect_uri"), config.callbackUrl);
      assertEquals(body.get("client_secret"), config.clientSecret);
      return Promise.resolve(
        Response.json({
          access_token: "user-token-sentinel",
          refresh_token: "refresh-token-sentinel",
        }),
      );
    }
    assertEquals(url.origin, "https://api.github.com");
    if (url.pathname.startsWith("/app/")) {
      assert(authorization && authorization.startsWith("Bearer "));
      const jwt = authorization.slice(7);
      jwtTokens.push(jwt);
      const [header, claims, signature] = jwt.split(".");
      assert(
        verify(
          "RSA-SHA256",
          Buffer.from(`${header}.${claims}`),
          keys.publicKey,
          Buffer.from(signature, "base64url"),
        ),
      );
      assertEquals(
        JSON.parse(Buffer.from(claims, "base64url").toString()).iss,
        config.appId,
      );
      if (
        url.pathname === `/app/installations/${installationId}/access_tokens`
      ) {
        assertEquals(init.method, "POST");
        return Promise.resolve(
          Response.json({ token: "installation-token-sentinel" }),
        );
      }
      assertEquals(url.pathname, `/app/installations/${installationId}`);
      return Promise.resolve(
        Response.json({
          account: {
            id: options.accountId ?? 7,
            login: "octocat",
            type: options.organization ? "Organization" : "User",
          },
          suspended_at: options.suspended ? "2026-01-01T00:00:00Z" : null,
        }),
      );
    }
    if (url.pathname === "/installation/repositories") {
      assertEquals(authorization, "Bearer installation-token-sentinel");
      assertEquals(url.search, "?per_page=100&page=1");
      return Promise.resolve(
        Response.json({
          repositories: available.map((repo) => ({
            ...repo,
            owner: { login: repo.org },
          })),
        }),
      );
    }
    assertEquals(authorization, "Bearer user-token-sentinel");
    if (url.pathname === "/user") {
      return Promise.resolve(Response.json({ id: options.identityId ?? 7 }));
    }
    assertEquals(url.pathname, "/user/memberships/orgs/octocat");
    return Promise.resolve(
      Response.json({
        state: "active",
        role: options.membershipRole ?? "admin",
      }),
    );
  };
  const service = new GithubConnectionsService(
    repository,
    () => config,
    fetcher,
    (path) => {
      assertEquals(path, config.keyPath);
      return Promise.resolve(pem);
    },
  );
  async function begin() {
    const install = await service.start(user, workspaceId);
    returned.push(install);
    const installUrl = new URL(install.redirectUrl);
    assertEquals(installUrl.pathname, "/apps/test-app/installations/new");
    const installState = installUrl.searchParams.get("state")!;
    const auth = await service.callback(user, {
      state: installState,
      installationId,
    });
    returned.push(auth);
    assert("redirectUrl" in auth);
    assertEquals(
      calls.length,
      0,
      "Install callback alone must not authorize a connection",
    );
    assertEquals(savedConnections.length, 0);
    const url = new URL(auth.redirectUrl);
    assertEquals(url.pathname, "/login/oauth/authorize");
    assertEquals(url.searchParams.get("code_challenge_method"), "S256");
    assertEquals(
      url.searchParams.get("code_challenge"),
      createHash("sha256").update(verifier!).digest("base64url"),
    );
    const state = url.searchParams.get("state")!;
    assert(
      state !== installState,
      "Installation and authorization use separate states",
    );
    assertEquals(attempts.size, 1);
    return state;
  }
  async function connect() {
    const state = await begin();
    const result = await service.callback(user, {
      state,
      code: "code-sentinel",
    });
    returned.push(result);
    return result;
  }
  return {
    service,
    repository,
    writes,
    returned,
    calls,
    attached,
    savedConnections,
    attempts,
    jwtTokens,
    begin,
    connect,
    setAvailable: (repos: AvailableRepository[]) => {
      available = repos;
    },
  };
}

test("GitHub connections: install → authorize → connect → list → add without leaking credentials", async () => {
  const f = fixture();
  assertEquals(await f.connect(), { workspaceId, installationId });
  assertEquals(f.savedConnections, [
    {
      workspaceId,
      installationId,
      accountLogin: "octocat",
    },
  ]);
  assertEquals(f.attempts.size, 0);
  const listed = await f.service.available(user, workspaceId, installationId);
  assertEquals(listed.repositories, [first, second]);
  assertEquals(listed.addedRepositoryIds, []);
  const added = await f.service.add(user, workspaceId, installationId, [
    second.id,
  ]);
  assertEquals(added, { added: 1 });
  assertEquals(f.attached, [[second]]);
  const afterAdd = await f.service.available(user, workspaceId, installationId);
  assertEquals(afterAdd.repositories, [first, second]);
  assertEquals(afterAdd.addedRepositoryIds, [second.id]);
  // Check every persistence argument, not only the final connection object.
  const exposed = JSON.stringify([f.writes, f.returned, listed, added]);
  for (const secret of [
    "user-token-sentinel",
    "refresh-token-sentinel",
    "installation-token-sentinel",
    "code-sentinel",
    config.clientSecret,
    pem,
    ...f.jwtTokens,
  ]) {
    assert(
      !exposed.includes(JSON.stringify(secret).slice(1, -1)),
      "Provider credentials must not reach persistence or browser responses",
    );
  }
});

test.each([
  {
    name: "organization admin connects",
    options: { organization: true },
    error: null,
  },
  {
    name: "organization member rejected",
    options: { organization: true, membershipRole: "member" },
    error: "organization owner",
  },
  {
    name: "wrong login identity rejected",
    options: { identityId: 8 },
    error: "same GitHub account",
  },
  {
    name: "another personal account rejected",
    options: { accountId: 8 },
    error: "account owner",
  },
  {
    name: "suspended installation rejected",
    options: { suspended: true },
    error: "suspended",
  },
])("GitHub connections: $name", async (scenario) => {
  const f = fixture(scenario.options);
  if (scenario.error) {
    await assertRejects(
      () => f.connect(),
      (error: unknown) =>
        error instanceof ConnectionError &&
        error.message.includes(scenario.error!),
    );
    assertEquals(f.savedConnections, []);
    assertEquals(f.attached, []);
  } else {
    await f.connect();
    assertEquals(f.savedConnections.length, 1);
    assert(f.calls.includes("/user/memberships/orgs/octocat"));
  }
});

test("GitHub connections: pending organization approval never calls GitHub or saves a connection", async () => {
  const f = fixture();
  const start = await f.service.start(user, workspaceId);
  await assertRejects(
    () =>
      f.service.callback(user, {
        state: new URL(start.redirectUrl).searchParams.get("state")!,
        setupAction: "request",
      }),
    (error: unknown) =>
      error instanceof ConnectionError &&
      error.message.includes("approval is pending"),
  );
  assertEquals(f.calls, []);
  assertEquals(f.savedConnections, []);
  assertEquals(f.attempts.size, 0);
});

test("GitHub connections: unconfigured service fails before provider calls or persistence", async () => {
  const f = fixture();
  const service = new GithubConnectionsService(
    f.repository,
    () => {
      throw new GithubConnectionsConfigurationError();
    },
    () => {
      throw new Error("Unexpected fetch");
    },
  );
  await assertRejects(
    () => service.start(user, workspaceId),
    GithubConnectionsConfigurationError,
  );
  assertEquals(f.writes, []);
});

test("GitHub connections: Add re-fetches access and rejects a stale selection without writes", async () => {
  const f = fixture();
  await f.connect();
  assertEquals(
    (await f.service.available(user, workspaceId, installationId)).repositories,
    [first, second],
  );
  f.setAvailable([first]);
  const writesBefore = f.writes.length;
  await assertRejects(
    () =>
      f.service.add(user, workspaceId, installationId, [first.id, second.id]),
    (error: unknown) =>
      error instanceof ConnectionError &&
      error.message.includes("access changed"),
  );
  assertEquals(
    f.calls.filter((path) => path === "/installation/repositories").length,
    2,
  );
  assertEquals(f.attached, []);
  assertEquals(
    f.writes.length,
    writesBefore,
    "A mixed valid/invalid selection must not partially persist",
  );
});
