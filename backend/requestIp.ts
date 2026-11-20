const FORWARDED_CLIENT_IP_HEADER = "x-devthropology-client-ip";

function extractFirstForwardedIp(
  forwardedFor: string | null | undefined,
): string | undefined {
  if (!forwardedFor) {
    return undefined;
  }

  const firstIp = forwardedFor.split(",")[0]?.trim();
  return firstIp || undefined;
}

function getAppForwardedClientIp(headers: Headers): string | undefined {
  return headers.get(FORWARDED_CLIENT_IP_HEADER) || undefined;
}

function getGenericProxyClientIp(headers: Headers): string | undefined {
  return (
    headers.get("x-real-ip") ||
    extractFirstForwardedIp(headers.get("x-forwarded-for"))
  );
}

function getCloudflareClientIp(headers: Headers): string | undefined {
  return (
    headers.get("true-client-ip") ||
    headers.get("cf-connecting-ip") ||
    undefined
  );
}

export function getRequestIp(
  headers: Headers,
  remoteAddr?: string | null,
): string | undefined {
  const appForwardedClientIp = getAppForwardedClientIp(headers);

  // Prefer the app's dedicated forwarded header first. For direct traffic to
  // the backend behind Cloudflare, CF-Connecting-IP is the most reliable source
  // of the visitor IP and should beat generic proxy headers like X-Real-IP.
  return (
    appForwardedClientIp ||
    getCloudflareClientIp(headers) ||
    getGenericProxyClientIp(headers) ||
    remoteAddr ||
    undefined
  );
}

export function getRequestUserAgent(headers: Headers): string | undefined {
  if (headers.get("cf-worker")) {
    return (
      headers.get("x-original-user-agent") ||
      headers.get("user-agent") ||
      undefined
    );
  }

  return headers.get("user-agent") || undefined;
}

export function getForwardableClientIp(headers: Headers): string | undefined {
  return (
    getCloudflareClientIp(headers) ||
    extractFirstForwardedIp(headers.get("x-forwarded-for")) ||
    headers.get("x-real-ip") ||
    undefined
  );
}
