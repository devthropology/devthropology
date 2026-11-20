import { requireUserSession } from "./session.server";

export function requireNonDemoUser(userSession: { role: string }) {
  if (userSession.role === "demo") {
    throw new Response("Not Found", { status: 404, statusText: "Not Found" });
  }
}

export async function requireAdminSession(request: Request, url = new URL(request.url)) {
  const userSession = await requireUserSession(request, url);
  requireNonDemoUser(userSession);
  return userSession;
}
