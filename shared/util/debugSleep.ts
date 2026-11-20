export const MAX_DEBUG_SLEEP_MS = 30_000;

export function parseDurationMs(
  rawValue: string | null,
  maxMs: number,
): number | null {
  if (!rawValue) {
    return null;
  }

  const trimmed = rawValue.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^(\d+(?:\.\d+)?)(ms|s)?$/);
  if (!match) {
    return null;
  }

  const numericValue = Number(match[1]);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null;
  }

  const multiplier = match[2] === "s" ? 1000 : 1;
  return Math.min(Math.round(numericValue * multiplier), maxMs);
}
