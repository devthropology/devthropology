# Repository Guidelines

## Project Summary

- Devthropology is a PR-based GitHub analytics platform focused on people
  metrics, velocity, and knowledge risk.
- Pipeline: GitHub PR data -> Postgres -> Remix UI dashboards and reports.

## Project Structure & Module Organization

- `backend/` — Hono API server (`main.ts`), services, middleware, tests.
- `frontend/` — React Router + Vite frontend (Node 26+ workspace tooling).
- `backend/repository/` — Postgres data access and SQL queries.
- `backend/models/` — Server-only types and schemas.
- `shared/` — Browser-safe types, schemas, and utilities used by both apps.
- `backend/backfill/` — Legacy backfill logic used by the CLI.
- `backend/api/` — Legacy GitHub API client (`ghApi.ts`).
- `backend/test/` — Fixtures and integration tests.
- `backend/schema_migrations/postgres/` — DBMate migrations.

### Backend Feature Organization

- For new backend product features, prefer `backend/features/<feature>/`.
- Use feature-specific filenames such as `trendsRoutes.ts`,
  `trendsService.ts`, and `trendsRepository.ts`.
- Prefer route -> feature service -> feature repository/query.
- Keep shared infrastructure horizontal: `backend/main.ts` for app bootstrap,
  plus shared middleware, auth, DB clients, models, and utilities.
- Avoid adding new feature code to `backend/service.ts` or broad catch-all
  repositories when a feature-local module is more appropriate.

## Core Routes & Features

- Main views: `/app` (overview), `/app/contributors`, `/app/reviewers`,
  `/app/filesystem`, `/app/users/:username`, `/app/sync`, `/app/settings`.

## Build, Test, and Development Commands

- Node version: `.node-version` at the root and in `frontend/` (for Cloudflare Pages).
  Keep both files aligned when upgrading Node.
- Install all workspaces: `pnpm install --frozen-lockfile` (Node 26+, pinned pnpm).
- Backend server: `pnpm run dev` (watches backend changes).
- Frontend dev: `pnpm run startFe` or `cd frontend && pnpm run dev`.
- CLI backfill: `pnpm cli backfill -r org/repo -u you -a` (uses `DATABASE_URL_PG`).
<!--
- Agent context CLI: when you find task-relevant files, run
  `devthropology related-files <file...>` on repo-relative paths to discover
  historically co-changed files. `shared_prs` counts merged PRs touching both
  files; `cochange_pct` is the percent of the input file's PRs that also
  touched the related file. Briefly mention whether the CLI surfaced useful
  additional files or no relevant additions.
-->
- CLI create user:
  `pnpm cli auth create-user -u <user> -p <pass> -r admin`.
  Add `--print-token` to output the bearer token.
- Type check: `pnpm run check`.
- Backend lint: `pnpm run lint` (oxlint); autofix: `pnpm run lint:fix`.
- Format: `pnpm run format`; check: `pnpm run format:check`.
- Tests: `pnpm test` (both workspaces); `pnpm test:backend` includes shared tests. Filter with `pnpm test:backend -t "test name"`.
- Coverage is not configured; install a matching Vitest coverage provider before
  using `pnpm test:backend --coverage`.
- DB migrations (Postgres): `pnpm run db:new|db:migrate|db:rollback|db:status`.

## Dev Ports & Env

- Backend port: set `BACKEND_PORT` (or `PORT`) for `pnpm run dev`.
- Frontend dev port: set `VITE_FRONTEND_PORT` for `pnpm run startFe`.
- Frontend backend target: set `VITE_BACKEND_PORT` or `VITE_BACKEND_API_URL`.
- Example backend: `BACKEND_PORT=8010 pnpm run dev`.
- Example frontend: `VITE_BACKEND_PORT=8010 VITE_FRONTEND_PORT=3001 pnpm run startFe`.
- Basic verify: hit `http://localhost:<BACKEND_PORT>/` for the backend and
  confirm `/app` loads in the frontend.
- If a port is in use, increment and retry (backend first, then frontend).
- Keep backend/frontend ports in lockstep so the suffix matches: `8001/3001`,
  `8002/3002`, etc. If backend is `8005`, frontend should be `3005`.
## Run and Verify (Local)

- Start backend first, then frontend, using port overrides if needed.
- Create a local login via CLI, then use the UI at `/login`.
- Suggested dev user: `agent_<epoch_seconds>` with a one-off password.

### Browser Verification for UI Changes

- Verify changed UI flows in a real browser when available, not just via unit tests.
- Use a dedicated agent Chrome profile, never the user's personal profile.
  The user can launch one on macOS and log in manually:
  ```bash
  open -na "Google Chrome" --args \
    --user-data-dir="$HOME/.chrome-agent-profile" \
    --remote-debugging-address=127.0.0.1 \
    --remote-debugging-port=9222
  ```
- Check `http://127.0.0.1:9222/json/version` for an existing debugging session.
  Connect with browser tooling (for example, Playwright's `chromium.connectOverCDP`).
  Keep temporary verification tooling outside the repo unless it is a requested dependency.
- Ask for the app URL if unknown; use the running app and signed-in session.
  Open a new tab; do not navigate or close the user's existing tabs, log them out,
  or close their browser. Disconnect automation when finished.
- Keep debugging local-only. The endpoint grants control over the profile;
  never expose it publicly or print cookies, tokens, or passwords. Remind the
  user to close the dedicated browser when finished to stop debugging access.
- Exercise the changed flow end to end: navigation, expected controls, and a
  representative fetch or interaction. Check errors and empty states where relevant.
- For permission changes, verify allowed and denied roles with automated tests;
  use separate browser sessions for role checks when accounts are available.
  Do not bypass auth or change the user's account to test permissions.
- Follow the test-confirmation rule below. Report which browser flows and tests
  passed, what could not be verified, and whether role checks were browser-based
  or automated. Never claim browser verification based only on code inspection.

## Coding Style & Naming Conventions

- TypeScript (Node 26+ backend; Node for `frontend`).
- Prefer named exports; avoid default exports.
- Filenames: `camelCase.ts`; tests `*.test.ts` colocated or under `backend/test/`.
- Use Zod schemas for external data; keep models in `backend/models/`.
- Format/lint examples: `pnpm run format` and `pnpm run lint` (repo root).
- Formatting covers Git-tracked source files only; stage new files first.
  Markdown and `frontend/` are excluded from root formatting.
- Root oxlint excludes `frontend/`; frontend lint remains configured separately
  in `frontend/`.

## Testing Guidelines

- Framework: Vitest. Prefer colocated tests (`file.test.ts`) next to sources.
- Prefer unit tests for smaller components when it’s easy to isolate.
- For service-level tests, prefer snapshot testing when responses are stable and
  readable.
- Prefer focused assertion-based tests for validation, branching, and business
  rules.
- `backend/test/` remains for shared fixtures and integration data.
- E2E/API tests live in `backend/main.test.ts` and `backend/service.test.ts`;
  prefer snapshot tests for stable responses.
- When running tests locally, prefer targeted runs with
  `pnpm test:backend <file-or-folder>`.
- Use `-t` to narrow to specific test names when possible.
- The maintainer usually runs tests locally; confirm before running.

## Commit & Pull Request Guidelines

- Commits: short imperative subject; include scope/ticket as needed (e.g.,
  `Filesystem: handle removed files`, `[DEV-36] …`).
- PRs: clear description, steps to verify, screenshots for UI changes, and
  linked issues.
- When asked to create a PR, use a succinct title and body with bullet points
  explaining the work. Include extra details like "why" if the change is
  non-obvious or has architectural impact.

## Legacy & Migration Notes

- Treat `backend/backfill/` and `backend/api/` as legacy; prefer new logic in `backend/`
  feature modules or shared infrastructure as appropriate.
- `backend/queries/` is deprecated — do not extend.
- Align new endpoints with existing Remix routes in `frontend/app/routes/*`.

## Security & Configuration

- Required env: `GH_TOKEN`, `GH_USER`, `REPO_OWNER`, `REPO_NAME`,
  `DATABASE_URL_PG`, and `AUTH_PASSWORD_PEPPER`.
- If adding new required env vars, update `.env.example` accordingly (local
  `.env` may be copied into workspace trees).
- Local Postgres: `docker-compose up -d` (maps to `localhost:5433`). DBMate uses
  `DATABASE_URL_PG_DBMATE`.

### Frontend runtime config

- The frontend never loads the root `.env`. Server code reads `process.env`
  (shell, self-hosted service env, or Cloudflare Pages variables); `VITE_*`
  values are baked in at build time and may reach the browser, so never put
  secrets in `VITE_*` variables.
- Cloudflare Pages exposes variables via `process.env` only because
  `frontend/wrangler.toml` uses `compatibility_date >= 2025-04-01`; do not
  lower it. Read env lazily at request time, not at module load.
- Cloudflare Workers do not set `NODE_ENV` at runtime. Use the build-time
  `import.meta.env.PROD` / `DEV` for production checks in frontend code.
- Production requires `SESSION_SECRET` (cookie signing; comma-separated for
  rotation). Development falls back to an insecure built-in value.
- Cloudflare builds fail without `VITE_BACKEND_API_URL`; self-hosted and dev
  default to `localhost:8000`. Sentry is disabled unless `SENTRY_DSN` /
  `VITE_SENTRY_DSN` are set; there are no built-in fallbacks to our services.
- Local demo login returns 404 unless `ENABLE_DEMO_LOGIN=true`,
  `DEMO_USERNAME`, and `DEMO_PASSWORD` are set in the root `.env`.
