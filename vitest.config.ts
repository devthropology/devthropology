import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["{backend,shared}/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "frontend/**"],
    // Keep process-global state isolated and tests within each file sequential.
    pool: "forks",
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
