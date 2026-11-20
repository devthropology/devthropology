# Devthropology frontend

React 19 + [React Router 8 Framework Mode](https://reactrouter.com/), Vite 8,
TypeScript 7, and Tailwind CSS 3. Use the repository's pinned pnpm and Node 26+.

## Development

From the repository root, start the backend first, then the frontend:

```sh
BACKEND_PORT=8002 pnpm run dev
VITE_BACKEND_PORT=8002 VITE_FRONTEND_PORT=3002 pnpm run startFe
```

Use an unused matching port pair. Restart existing dev servers after dependency
upgrades. React Router 8 removed the Cloudflare dev proxy: `react-router dev`
now runs routes in Node. Our Cloudflare bindings are used only by the Pages
Functions middleware, which is exercised with the Pages preview below.

## Verification

From this directory:

```sh
pnpm run typecheck
pnpm run lint
pnpm exec oxlint --type-aware --type-check .
pnpm exec oxfmt --check .
pnpm test
pnpm run build
pnpm run build:self-hosted
```

Router 8 passes raw HTTP requests (including `.data` suffixes) to loaders.
Use the sibling `url` argument for routing and login redirect destinations;
keep `request` for headers, bodies, signals, and intentional raw API proxying.
Pass `url` through to `requireUserSession` / `requireAdminSession`.

## Cloudflare Pages

The deployment remains Pages, not Workers. The build outputs `build/client` and
`build/server`; `functions/[[path]].ts` serves SSR with a per-request
`RouterContextProvider`. `functions/_middleware.ts` owns Cloudflare Sentry setup.

```sh
pnpm run build
pnpm start
```

`pnpm start` runs a **local** Wrangler Pages preview. To preview against a local
backend rather than the production API, build with an explicit target:

```sh
VITE_BACKEND_API_URL=http://localhost:8002 pnpm run build
pnpm exec wrangler pages dev ./build/client --port 8788
```

Wrangler is pinned to **4.107.1**, the latest release whose worker-types peer
range overlaps `@react-router/cloudflare@8.4.0` and our Sentry 10 SDK.
Newer Wrangler releases require worker-types 5, while the Router Pages adapter
still requires worker-types 4. Recheck those peer ranges before upgrading;
do not hide the incompatibility with peer overrides.

## Self-hosted Node

```sh
pnpm run build:self-hosted
VITE_BACKEND_PORT=8002 VITE_FRONTEND_PORT=3002 pnpm run start:self-hosted
```

Deploy both `build-self-hosted/client` and `build-self-hosted/server`.
React 19 supports the Web Streams SSR renderer on Node directly, so the old
React 18 `react-dom/server.browser` alias is no longer needed.
For local HTTP login only, set `FRONTEND_HOST=localhost` and
`ALLOW_INSECURE_LOCAL_HTTP=true`; production should use HTTPS.
