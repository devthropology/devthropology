import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sentryVitePlugin } from "@sentry/vite-plugin";

vi.mock("@react-router/dev/vite", () => ({ reactRouter: () => ({ name: "router" }) }));
vi.mock("@sentry/vite-plugin", () => ({
  sentryVitePlugin: vi.fn(() => ({ name: "sentry" })),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
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
