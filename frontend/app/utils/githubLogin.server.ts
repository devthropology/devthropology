import { createCookie } from "react-router";
import { z } from "zod";
import { API_URL } from "~/config";
import { createUserSession, getUserSession, sanitizeRedirectTarget } from "./session.server";
import { REPO_ID_KEY } from "./repositoryPreferences";
import {
  parseGithubLoginErrorCode,
  type GithubLoginErrorCode,
} from "../../../shared/models/githubLogin";

const SecretSchema = z.string().regex(/^[a-f0-9]{64}$/);
const LoginSchema = z.object({
  userId: z.string().uuid(),
  username: z.string().min(1),
  role: z.string().min(1),
  token: z.string().min(1),
  redirectTo: z.string(),
});

function browserCookie(request: Request) {
  // The random value is bound to a single DB attempt, not trusted as session data.
  const secure = new URL(request.url).protocol === "https:";
  return createCookie(secure ? "__Host-github_login" : "github_login", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
}

function responseHeaders() {
  return new Headers({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
}

async function loginFailure(request: Request, code: GithubLoginErrorCode) {
  const headers = responseHeaders();
  headers.set("Location", `/login?githubError=${encodeURIComponent(code)}`);
  headers.append("Set-Cookie", await browserCookie(request).serialize("", { maxAge: 0 }));
  return new Response(null, { status: 302, headers });
}

async function backendRequest(operation: "start" | "callback", body: unknown) {
  // Server-to-server only. No automatic retries of single-use authorization codes,
  // no browser redirect containing a bearer token, and no credential logging.
  const response = await fetch(`${API_URL}/api/auth/github/${operation}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
    // Workers does not support redirect: "error". Never forward secrets to redirects.
    redirect: "manual",
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error("Unexpected backend redirect");
  }
  return response;
}

async function errorCode(response: Response): Promise<GithubLoginErrorCode> {
  const parsed = z.object({ error: z.string() }).safeParse(await response.json());
  return parseGithubLoginErrorCode(parsed.success ? parsed.data.error : undefined);
}

export async function startGithubLogin(request: Request) {
  // Require a same-origin form submission rather than allowing cross-site login starts.
  if (request.headers.get("Origin") !== new URL(request.url).origin) {
    return new Response("Invalid request origin", { status: 403, headers: responseHeaders() });
  }
  const user = await getUserSession(request);
  if (user)
    return new Response(null, {
      status: 302,
      headers: { ...Object.fromEntries(responseHeaders()), Location: "/app" },
    });
  try {
    const form = await request.formData();
    const target = form.get("redirectTo");
    const redirectTo = sanitizeRedirectTarget(typeof target === "string" ? target : null);
    const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const response = await backendRequest("start", { browserSecret: secret, redirectTo });
    if (!response.ok) return loginFailure(request, await errorCode(response));
    const { authorizationUrl } = z
      .object({ authorizationUrl: z.string().url() })
      .parse(await response.json());
    const destination = new URL(authorizationUrl);
    if (
      destination.origin !== "https://github.com" ||
      destination.pathname !== "/login/oauth/authorize"
    ) {
      return loginFailure(request, "unavailable");
    }
    const headers = responseHeaders();
    headers.set("Location", destination.href);
    headers.append("Set-Cookie", await browserCookie(request).serialize(secret));
    return new Response(null, { status: 302, headers });
  } catch {
    return loginFailure(request, "unavailable");
  }
}

export async function completeGithubLogin(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const secret = SecretSchema.safeParse(
      await browserCookie(request).parse(request.headers.get("Cookie")),
    );
    const state = SecretSchema.safeParse(params.get("state"));
    if (!secret.success || !state.success) return loginFailure(request, "invalid_state");
    const response = await backendRequest("callback", {
      browserSecret: secret.data,
      state: state.data,
      code: params.get("code") ?? undefined,
      error: params.get("error") ?? undefined,
    });
    if (!response.ok) return loginFailure(request, await errorCode(response));
    const account = LoginSchema.parse(await response.json());
    const session = await createUserSession(
      account.userId,
      account.username,
      account.role,
      account.token,
      sanitizeRedirectTarget(account.redirectTo),
      // Do not carry a previous account's repository selection into this session.
      `${REPO_ID_KEY}=; Path=/; Max-Age=0`,
    );
    session.headers.set("Cache-Control", "no-store");
    session.headers.set("Referrer-Policy", "no-referrer");
    session.headers.append("Set-Cookie", await browserCookie(request).serialize("", { maxAge: 0 }));
    return session;
  } catch {
    return loginFailure(request, "unavailable");
  }
}
