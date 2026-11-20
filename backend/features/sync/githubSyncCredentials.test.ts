import { test } from "vitest";
import {
  deepStrictEqual as assertEquals,
  ok as assert,
  rejects as assertRejects,
} from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import type { SqlClient } from "../../repository/sqlClient.ts";
import { ConnectionError } from "../githubConnections/githubConnectionsRepository.ts";
import {
  GithubInstallationCredentials,
  resolveGithubSyncCredentials,
} from "./githubSyncCredentials.ts";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const config = {
  appId: "123",
  slug: "test",
  keyPath: "test.pem",
  clientId: "client",
  clientSecret: "secret",
  callbackUrl: "https://example.com/callback",
};

function fixture() {
  let now = Date.now();
  let calls = 0;
  let response: unknown;
  let status = 200;
  const credentials = new GithubInstallationCredentials("456", 789, {
    now: () => now,
    getConfig: () => config,
    readKey: (path) => {
      assertEquals(path, "test.pem");
      return Promise.resolve(pem);
    },
    fetcher: (input, init) => {
      calls++;
      assertEquals(
        String(input),
        "https://api.github.com/app/installations/456/access_tokens",
      );
      assertEquals(init?.method, "POST");
      assertEquals(JSON.parse(String(init?.body)), { repository_ids: [789] });
      assert(
        new Headers(init?.headers).get("Authorization")?.startsWith("Bearer "),
      );
      return Promise.resolve(
        Response.json(
          response ?? {
            token: `token-${calls}`,
            expires_at: new Date(now + 3_600_000).toISOString(),
          },
          { status },
        ),
      );
    },
  });
  return {
    credentials,
    calls: () => calls,
    advance: (ms: number) => {
      now += ms;
    },
    respond: (body: unknown, code = 200) => {
      response = body;
      status = code;
    },
  };
}

test("installation credentials cache and share initial mint and renewal", async () => {
  const f = fixture();
  assertEquals(
    await Promise.all(
      Array.from({ length: 5 }, () => f.credentials.getAuthorizationHeader()),
    ),
    Array(5).fill("Bearer token-1"),
  );
  assertEquals(f.calls(), 1);
  f.advance(3_539_999);
  assertEquals(await f.credentials.getAuthorizationHeader(), "Bearer token-1");
  f.advance(1);
  assertEquals(
    await Promise.all([
      f.credentials.getAuthorizationHeader(),
      f.credentials.getAuthorizationHeader(),
    ]),
    ["Bearer token-2", "Bearer token-2"],
  );
  assertEquals(f.calls(), 2);
});

test("installation credentials reject invalid/expired responses without exposing tokens", async () => {
  for (const expires_at of ["invalid", new Date(0).toISOString()]) {
    const f = fixture();
    f.respond({ token: "sensitive-token", expires_at });
    await assertRejects(
      () => f.credentials.getAuthorizationHeader(),
      (error: unknown) => {
        assert(error instanceof ConnectionError);
        assert(!error.message.includes("sensitive-token"));
        return true;
      },
    );
  }
});

test("failed renewal cannot reuse stale token and can recover on next request", async () => {
  const f = fixture();
  await f.credentials.getAuthorizationHeader();
  f.advance(3_600_000);
  f.respond({ message: "denied" }, 403);
  await assertRejects(
    () => f.credentials.getAuthorizationHeader(),
    ConnectionError,
  );
  f.respond(undefined);
  assertEquals(await f.credentials.getAuthorizationHeader(), "Bearer token-3");
});

const user = { userId: "user", username: "owner", role: "user" };
const connection = {
  workspaceId: "workspace",
  installationId: "456",
  accountLogin: "owner",
  githubRepositoryId: "789",
};

function fakeSql(connections: unknown[], owned: unknown[]): SqlClient {
  return ((strings: TemplateStringsArray) => {
    const query = strings.join("?");
    if (query.includes("FROM workspace_github_repository")) {
      assert(query.includes("ORDER BY g.workspace_id, g.installation_id"));
      return Promise.resolve(connections);
    }
    assert(query.includes("FROM workspace w"));
    return Promise.resolve(owned);
  }) as unknown as SqlClient;
}

test("sync resolver preserves legacy and fails closed for unauthorized/unverified connections", async () => {
  assertEquals(
    await resolveGithubSyncCredentials(fakeSql([], []), user, 16),
    undefined,
  );
  for (const [connections, owned] of [
    [[connection], []],
    [[{ ...connection, accountLogin: null }], [{ workspaceId: "workspace" }]],
  ]) {
    await assertRejects(
      () => resolveGithubSyncCredentials(fakeSql(connections, owned), user, 16),
      ConnectionError,
    );
  }
  const resolved = await resolveGithubSyncCredentials(
    fakeSql([connection], [{ workspaceId: "workspace" }]),
    user,
    16,
  );
  assert(resolved instanceof GithubInstallationCredentials);
});

test("sync resolver rejects corrupt repository identity as server error, not authorization error", async () => {
  for (const githubRepositoryId of [null, "bad", "0", "9007199254740992"]) {
    await assertRejects(
      () =>
        resolveGithubSyncCredentials(
          fakeSql(
            [{ ...connection, githubRepositoryId }],
            [
              {
                workspaceId: "workspace",
              },
            ],
          ),
          user,
          16,
        ),
      (error: unknown) => {
        assert(error instanceof Error);
        assert(
          error.message.includes(
            "Saved GitHub repository identity is invalid.",
          ),
        );
        assert(!(error instanceof ConnectionError));
        return true;
      },
    );
  }
});
