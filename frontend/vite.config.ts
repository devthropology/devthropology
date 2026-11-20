import { reactRouter } from "@react-router/dev/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { defineConfig, type Plugin } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const selfHosted = process.env.SELF_HOSTED === "true";
const buildDirectory = selfHosted ? "build-self-hosted" : "build";
const backendTarget =
  process.env.VITE_BACKEND_API_URL ||
  (process.env.VITE_BACKEND_PORT
    ? `http://localhost:${process.env.VITE_BACKEND_PORT}`
    : "http://localhost:8000");
const frontendPortEnv = process.env.VITE_FRONTEND_PORT;
const frontendPort = frontendPortEnv ? Number(frontendPortEnv) : undefined;
const resolvedFrontendPort = Number.isFinite(frontendPort) ? frontendPort : undefined;
const sentryRelease = process.env.SENTRY_RELEASE || process.env.CF_PAGES_COMMIT_SHA;
const shouldUploadSentryArtifacts = Boolean(process.env.SENTRY_AUTH_TOKEN);

// Cloudflare builds bake the API URL into the bundle; fail instead of guessing.
// Checked at build start so config-only commands (typegen, vitest) still work.
function requireBackendApiUrl(): Plugin {
  let apiUrl: string | undefined;
  return {
    name: "require-backend-api-url",
    apply: "build",
    configResolved(config) {
      apiUrl = config.env.VITE_BACKEND_API_URL;
    },
    buildStart() {
      if (!selfHosted && !apiUrl) {
        this.error("VITE_BACKEND_API_URL must be set for Cloudflare builds");
      }
    },
  };
}

export default defineConfig({
  plugins: [
    // Pages bindings are only used in functions/; local routes run in Node.
    reactRouter(),
    requireBackendApiUrl(),
    sentryVitePlugin({
      org: "devthropology",
      project: "javascript-remix",
      authToken: process.env.SENTRY_AUTH_TOKEN,
      release: {
        name: sentryRelease,
      },
      sourcemaps: {
        filesToDeleteAfterUpload: [
          `./${buildDirectory}/client/**/*.map`,
          `./${buildDirectory}/server/**/*.map`,
        ],
      },
      disable: !shouldUploadSentryArtifacts,
    }),
  ],
  define: {
    "import.meta.env.SELF_HOSTED": JSON.stringify(selfHosted),
  },
  build: {
    sourcemap: shouldUploadSentryArtifacts ? "hidden" : false,
  },
  resolve: {
    tsconfigPaths: true,
    dedupe: ["zod"],
    alias: selfHosted
      ? {
          "@sentry/cloudflare": resolve(__dirname, "app/utils/selfHostedSentry.ts"),
        }
      : {},
  },
  server: {
    allowedHosts: process.env.AMP_ORB ? true : undefined,
    port: resolvedFrontendPort,
    strictPort: false,
    watch: {
      ignored: ["**/*.timestamp-*.mjs"],
    },
    proxy: {
      "/api": {
        target: backendTarget, // backend server
        changeOrigin: true, // rewrites origin header to match target
        secure: false, // ignore self-signed SSL certs (not relevant here)
      },
    },
  },
});
