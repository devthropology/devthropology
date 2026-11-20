import { route, type RouteConfig } from "@react-router/dev/routes";
import { flatRoutes } from "@react-router/fs-routes";

export default [
  ...(await flatRoutes()),
  ...(process.env.SELF_HOSTED === "true" ? [route("api/*", "apiProxy.ts")] : []),
] satisfies RouteConfig;
