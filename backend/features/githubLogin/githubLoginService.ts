import { env } from "node:process";
import { z } from "zod";
import type {
  GithubLoginRepository,
  ProvisionedAccount,
} from "./githubLoginRepository.ts";
import type { GithubLoginErrorCode } from "../../../shared/models/githubLogin.ts";

export class GithubLoginError extends Error {
  constructor(public readonly code: GithubLoginErrorCode) {
    super(code);
  }
}

export interface GithubLoginConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

export function getGithubLoginConfig(): GithubLoginConfig {
  const clientId = env.GITHUB_APP_CLIENT_ID;
  const clientSecret = env.GITHUB_APP_CLIENT_SECRET;
  const callbackUrl = env.GITHUB_APP_CALLBACK_URL;
  if (!clientId || !clientSecret || !callbackUrl) {
    throw new GithubLoginError("not_configured");
  }
  let url: URL;
  try {
    url = new URL(callbackUrl);
  } catch {
    throw new GithubLoginError("not_configured");
  }
  if (
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      )) ||
    url.pathname !== "/auth/github/callback" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new GithubLoginError("not_configured");
  return { clientId, clientSecret, callbackUrl };
}

export function randomSecret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function sha256Base64Url(value: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

const IdentitySchema = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  login: z.string().min(1).max(100),
});
const TokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.literal("bearer"),
});

type LoginRepository = Pick<
  GithubLoginRepository,
  "saveAttempt" | "consumeAttempt" | "provision"
>;

export class GithubLoginService {
  constructor(
    private readonly repository: LoginRepository,
    private readonly config: GithubLoginConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async start(
    browserSecret: string,
    redirectTo: string,
  ): Promise<{ authorizationUrl: string }> {
    const state = randomSecret();
    const verifier = randomSecret();
    await this.repository.saveAttempt(
      await sha256Base64Url(state),
      await sha256Base64Url(browserSecret),
      verifier,
      redirectTo,
    );
    const url = new URL("https://github.com/login/oauth/authorize");
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.callbackUrl,
      state,
      code_challenge: await sha256Base64Url(verifier),
      code_challenge_method: "S256",
      // GitHub App permissions are configured in its registration, not OAuth scopes.
    }).toString();
    return { authorizationUrl: url.href };
  }

  async complete(input: {
    state: string;
    browserSecret: string;
    code?: string;
    error?: string;
  }): Promise<ProvisionedAccount & { redirectTo: string }> {
    const attempt = await this.repository.consumeAttempt(
      await sha256Base64Url(input.state),
      await sha256Base64Url(input.browserSecret),
    );
    if (!attempt) throw new GithubLoginError("invalid_state");
    // Consume even denied/failed attempts. Retries must start a fresh authorization.
    if (input.error) {
      throw new GithubLoginError(
        input.error === "access_denied" ? "denied" : "provider_failed",
      );
    }
    if (!input.code) throw new GithubLoginError("provider_failed");

    let identity: z.infer<typeof IdentitySchema>;
    try {
      const tokenResponse = await this.fetcher(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
            redirect_uri: this.config.callbackUrl,
            code: input.code,
            code_verifier: attempt.codeVerifier,
          }),
          signal: AbortSignal.timeout(10_000),
          redirect: "error",
        },
      );
      if (!tokenResponse.ok) throw new Error("Token exchange failed");
      const token = TokenSchema.parse(await tokenResponse.json());
      const userResponse = await this.fetcher("https://api.github.com/user", {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token.access_token}`,
          "User-Agent": "Devthropology",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
      });
      if (!userResponse.ok) throw new Error("Identity request failed");
      identity = IdentitySchema.parse(await userResponse.json());
      // Neither the user access token nor any refresh token is persisted or returned.
    } catch {
      // Do not log provider payloads, authorization codes, or credentials.
      throw new GithubLoginError("provider_failed");
    }
    const account = await this.repository.provision(
      String(identity.id),
      identity.login,
    );
    if (!account) throw new GithubLoginError("account_unavailable");
    return {
      ...account,
      redirectTo: account.isNew ? "/app/settings" : attempt.redirectTo,
    };
  }
}
