import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  buildDirectory: process.env.SELF_HOSTED === "true" ? "build-self-hosted" : "build",
} satisfies Config;
