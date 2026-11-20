import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sentryVitePlugin } from "@sentry/vite-plugin";

vi.mock("@react-router/dev/vite", () => ({ reactRouter: () => ({ name: "router" }) }));
vi.mock("@sentry/vite-plugin", () => ({
  sentryVitePlugin: vi.fn(() => ({ name: "sentry" })),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("VERCEL", undefined);
  vi.stubEnv("SENTRY_AUTH_TOKEN", "test-only-not-a-real-token");
});
afterEach(() => vi.unstubAllEnvs());

it.each([
  ["true", "build-self-hosted"],
  ["false", "build"],
])("cleans source maps from the selected output (SELF_HOSTED=%s)", async (mode, directory) => {
  vi.stubEnv("SELF_HOSTED", mode);
  const { default: config } = await import("../vite.config");
  expect(config.build?.sourcemap).toBe("hidden");
  expect(
    vi.mocked(sentryVitePlugin).mock.calls[0][0]?.sourcemaps?.filesToDeleteAfterUpload,
  ).toEqual([`./${directory}/client/**/*.map`, `./${directory}/server/**/*.map`]);
});

it("aliases @sentry/cloudflare and disables Sentry upload when VERCEL=1 without SENTRY_AUTH_TOKEN", async () => {
  vi.stubEnv("SELF_HOSTED", undefined);
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("SENTRY_AUTH_TOKEN", "");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abc1234");
  const { default: config } = await import("../vite.config");
  expect(config.build?.sourcemap).toBe(false);
  expect(config.resolve?.alias).toHaveProperty("@sentry/cloudflare");
  expect(vi.mocked(sentryVitePlugin).mock.calls[0][0]?.disable).toBe(true);
  expect(vi.mocked(sentryVitePlugin).mock.calls[0][0]?.release?.name).toBe("abc1234");
});
