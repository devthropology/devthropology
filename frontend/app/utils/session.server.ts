import { createCookieSessionStorage } from "react-router";

type SessionData = {
  userId: string;
  username: string;
  role: string;
  token: string;
};

type SessionFlashData = {
  error: string;
};

const DEFAULT_LOGIN_REDIRECT_PATH = "/app";

if (
  import.meta.env.SELF_HOSTED &&
  process.env.ALLOW_INSECURE_LOCAL_HTTP === "true" &&
  !["localhost", "127.0.0.1", "::1"].includes(process.env.HOST || "")
) {
  throw new Error("ALLOW_INSECURE_LOCAL_HTTP requires a loopback FRONTEND_HOST");
}

const DEV_SESSION_SECRET = "dev-only-insecure-session-secret";

// Comma-separated; the first secret signs, all secrets verify (for rotation).
export function getSessionSecrets(env: Record<string, string | undefined> = process.env): string[] {
  const secrets = (env.SESSION_SECRET ?? "")
    .split(",")
    .map((secret) => secret.trim())
    .filter(Boolean);

  if (secrets.length > 0) {
    return secrets;
  }

  // Build-time flag: Cloudflare Workers do not set NODE_ENV at runtime.
  if (import.meta.env.PROD) {
    throw new Error("SESSION_SECRET must be set in production");
  }

  return [DEV_SESSION_SECRET];
}

type SessionStorage = ReturnType<typeof createCookieSessionStorage<SessionData, SessionFlashData>>;

let sessionStorage: SessionStorage | undefined;

// Created on first use so runtime env (e.g. Cloudflare Pages secrets) is available.
function getSessionStorage(): SessionStorage {
  sessionStorage ??= createCookieSessionStorage<SessionData, SessionFlashData>({
    cookie: {
      name: "__session",
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
      sameSite: "lax",
      secrets: getSessionSecrets(),
      secure:
        import.meta.env.PROD &&
        !(import.meta.env.SELF_HOSTED && process.env.ALLOW_INSECURE_LOCAL_HTTP === "true"),
    },
  });
  return sessionStorage;
}

export const getSession: SessionStorage["getSession"] = (...args) =>
  getSessionStorage().getSession(...args);
export const commitSession: SessionStorage["commitSession"] = (...args) =>
  getSessionStorage().commitSession(...args);
export const destroySession: SessionStorage["destroySession"] = (...args) =>
  getSessionStorage().destroySession(...args);

export function sanitizeRedirectTarget(candidate: string | null | undefined): string {
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return DEFAULT_LOGIN_REDIRECT_PATH;
  }

  try {
    const parsedUrl = new URL(candidate, "http://local");

    if (parsedUrl.pathname !== "/app" && !parsedUrl.pathname.startsWith("/app/")) {
      return DEFAULT_LOGIN_REDIRECT_PATH;
    }

    return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
  } catch {
    return DEFAULT_LOGIN_REDIRECT_PATH;
  }
}

function buildLoginRedirectLocation(requestUrl: URL): string {
  const redirectTarget = sanitizeRedirectTarget(`${requestUrl.pathname}${requestUrl.search}`);

  return `/login?redirectTo=${encodeURIComponent(redirectTarget)}`;
}

export async function createUserSession(
  userId: string,
  username: string,
  role: string,
  token: string,
  redirectTo: string,
  repositoryCookie?: string,
) {
  const session = await getSession();
  session.set("userId", userId);
  session.set("username", username);
  session.set("role", role);
  session.set("token", token);

  const headers = new Headers({
    Location: sanitizeRedirectTarget(redirectTo),
  });
  headers.append("Set-Cookie", await commitSession(session));

  // If we have a repository cookie to set, add it as a second Set-Cookie header
  if (repositoryCookie) {
    headers.append("Set-Cookie", repositoryCookie);
  }

  return new Response(null, {
    status: 302,
    headers,
  });
}

export async function getUserSession(request: Request) {
  const session = await getSession(request.headers.get("Cookie"));
  const userId = session.get("userId");
  const username = session.get("username");
  const role = session.get("role");
  const token = session.get("token");

  if (!userId || !username || !role || !token) {
    return null;
  }

  return { userId, username, role, token };
}

export async function logout(request: Request) {
  const session = await getSession(request.headers.get("Cookie"));
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": await destroySession(session),
    },
  });
}

// Repository ID cookie helpers
const REPO_ID_KEY = "selectedRepositoryId";
const DESKTOP_SIDEBAR_RAIL_KEY = "desktopSidebarRailMode";

export function getRepositoryIdFromCookie(request: Request): string | null {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;

  const repositoryId = cookieHeader
    .split(";")
    .find((c) => c.trim().startsWith(`${REPO_ID_KEY}=`))
    ?.split("=")[1];

  return repositoryId ? decodeURIComponent(repositoryId) : null;
}

export function createRepositoryIdCookie(repositoryId: string): string {
  return `${REPO_ID_KEY}=${encodeURIComponent(repositoryId)}; Path=/; Max-Age=${
    60 * 60 * 24 * 365
  }`;
}

export function getDesktopSidebarRailModeFromCookie(request: Request): boolean {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return false;

  return (
    cookieHeader
      .split(";")
      .find((c) => c.trim().startsWith(`${DESKTOP_SIDEBAR_RAIL_KEY}=`))
      ?.split("=")[1] === "1"
  );
}

export async function requireUserSession(request: Request, url = new URL(request.url)) {
  const userSession = await getUserSession(request);

  if (!userSession) {
    throw new Response(null, {
      status: 302,
      headers: {
        Location: buildLoginRedirectLocation(url),
      },
    });
  }

  return userSession;
}
