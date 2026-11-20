import { test } from "vitest";
import {
  deepStrictEqual as assertEquals,
  ok as assert,
  rejects as assertRejects,
} from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  GithubLoginError,
  GithubLoginService,
  sha256Base64Url,
} from "./githubLoginService.ts";
import type { LoginAttempt } from "./githubLoginRepository.ts";
import { createGithubLoginRoutes } from "./githubLoginRoutes.ts";

const config = {
  clientId: "app-client",
  clientSecret: "app-secret",
  callbackUrl: "https://frontend.test/auth/github/callback",
};
const browserSecret = "b".repeat(64);

function fixture(
  options: {
    isNew?: boolean;
    providerFailure?: boolean;
    inactive?: boolean;
  } = {},
) {
  const attempts = new Map<string, LoginAttempt & { browserHash: string }>();
  const calls: { url: string; init?: RequestInit }[] = [];
  let provisioned = 0;
  const service = new GithubLoginService(
    {
      saveAttempt(stateHash, browserHash, verifier, redirectTo) {
        attempts.set(stateHash, {
          browserHash,
          codeVerifier: verifier,
          redirectTo,
        });
        return Promise.resolve();
      },
      consumeAttempt(stateHash, browserHash) {
        const attempt = attempts.get(stateHash);
        if (!attempt || attempt.browserHash !== browserHash) {
          return Promise.resolve(null);
        }
        attempts.delete(stateHash);
        return Promise.resolve(attempt);
      },
      provision(id, login) {
        assertEquals(id, "1234");
        assertEquals(login, "octocat");
        provisioned++;
        return Promise.resolve(
          options.inactive
            ? null
            : {
                userId: "user-id",
                username: "octocat",
                role: "user",
                token: "application-token",
                isNew: options.isNew ?? true,
              },
        );
      },
    },
    config,
    (url, init) => {
      calls.push({ url: String(url), init });
      if (options.providerFailure) {
        return Promise.resolve(
          Response.json({ error: "bad_verification_code" }),
        );
      }
      return Promise.resolve(
        Response.json(
          String(url).endsWith("access_token")
            ? {
                access_token: "github-token",
                refresh_token: "github-refresh",
                token_type: "bearer",
              }
            : { id: 1234, login: "octocat" },
        ),
      );
    },
  );
  return { service, attempts, calls, provisioned: () => provisioned };
}

test("GitHub App login uses state, S256 PKCE, no scopes, and only returns application credentials", async () => {
  const f = fixture();
  const { authorizationUrl } = await f.service.start(
    browserSecret,
    "/app/r/repo",
  );
  const url = new URL(authorizationUrl);
  assertEquals(url.origin, "https://github.com");
  assertEquals(url.searchParams.get("client_id"), config.clientId);
  assertEquals(url.searchParams.get("redirect_uri"), config.callbackUrl);
  assertEquals(url.searchParams.get("code_challenge_method"), "S256");
  assertEquals(url.searchParams.has("scope"), false);
  assertEquals(url.searchParams.has("client_secret"), false);
  const state = url.searchParams.get("state")!;
  const attempt = f.attempts.get(await sha256Base64Url(state))!;
  assertEquals(attempt.browserHash, await sha256Base64Url(browserSecret));
  assertEquals(
    url.searchParams.get("code_challenge"),
    createHash("sha256").update(attempt.codeVerifier).digest("base64url"),
  );
  const result = await f.service.complete({
    state,
    browserSecret,
    code: "provider-code",
  });
  assertEquals(result.redirectTo, "/app/settings");
  assertEquals(result.token, "application-token");
  assert(!JSON.stringify(result).includes("github-token"));
  assert(!JSON.stringify(result).includes("github-refresh"));
  const exchange = f.calls[0].init!.body as URLSearchParams;
  assertEquals(exchange.get("code_verifier"), attempt.codeVerifier);
  assertEquals(exchange.get("client_secret"), config.clientSecret);
  assertEquals(
    (f.calls[1].init!.headers as Record<string, string>).Authorization,
    "Bearer github-token",
  );
  assertEquals(f.provisioned(), 1);
  await assertRejects(
    () => f.service.complete({ state, browserSecret, code: "provider-code" }),
    (error: unknown) =>
      error instanceof GithubLoginError &&
      error.message.includes("invalid_state"),
  );
  assertEquals(f.calls.length, 2);
});

test("GitHub login rejects browser mismatch, missing state, and cancelled consent before provider calls", async () => {
  const f = fixture();
  const url = new URL(
    (await f.service.start(browserSecret, "/app")).authorizationUrl,
  );
  const state = url.searchParams.get("state")!;
  await assertRejects(
    () =>
      f.service.complete({
        state,
        browserSecret: "c".repeat(64),
        code: "code",
      }),
    (error: unknown) =>
      error instanceof GithubLoginError &&
      error.message.includes("invalid_state"),
  );
  await assertRejects(
    () => f.service.complete({ state: "unknown", browserSecret, code: "code" }),
    (error: unknown) =>
      error instanceof GithubLoginError &&
      error.message.includes("invalid_state"),
  );
  await assertRejects(
    () => f.service.complete({ state, browserSecret, error: "access_denied" }),
    (error: unknown) =>
      error instanceof GithubLoginError && error.message.includes("denied"),
  );
  assertEquals(f.calls.length, 0);
  assertEquals(f.attempts.size, 0);
});

for (const { name, options, expectedError } of [
  {
    name: "repeat login preserves destination",
    options: { isNew: false },
    expectedError: null,
  },
  {
    name: "provider failure does not provision",
    options: { providerFailure: true },
    expectedError: "provider_failed",
  },
  {
    name: "inactive account is rejected",
    options: { inactive: true },
    expectedError: "account_unavailable",
  },
]) {
  test(`GitHub ${name}`, async () => {
    const f = fixture(options);
    const state = new URL(
      (await f.service.start(browserSecret, "/app/r/repo")).authorizationUrl,
    ).searchParams.get("state")!;
    const complete = () =>
      f.service.complete({ state, browserSecret, code: "code" });
    if (expectedError) {
      await assertRejects(
        complete,
        (error: unknown) =>
          error instanceof GithubLoginError &&
          error.message.includes(expectedError),
      );
      if (expectedError === "provider_failed") assertEquals(f.provisioned(), 0);
    } else {
      assertEquals((await complete()).redirectTo, "/app/r/repo");
    }
    assertEquals(f.attempts.size, 0);
  });
}

test("GitHub login routes validate inputs and report disabled configuration without caching", async () => {
  const routes = createGithubLoginRoutes(() => {
    throw new GithubLoginError("not_configured");
  });
  const request = (body: unknown) =>
    routes.request("/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  assertEquals((await request({ browserSecret: "bad" })).status, 400);
  const response = await request({ browserSecret });
  assertEquals(response.status, 503);
  assertEquals(response.headers.get("Cache-Control"), "no-store");
  assertEquals(await response.json(), { error: "not_configured" });
});
