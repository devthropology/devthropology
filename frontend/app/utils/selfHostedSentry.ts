// The self-hosted server logs locally instead of using the Cloudflare SDK.
// Browser error reporting continues to use @sentry/react.
export function captureException(error: unknown, _context?: unknown): string {
  console.error("[self-hosted]", error);
  return "";
}
