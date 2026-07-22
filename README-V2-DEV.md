# Kuma Mieru v2 development

This branch contains the v2 implementation. It is intentionally isolated from `main` and the
existing Next.js application while compatibility behavior is being proven.

## Local workspace

- Canonical v1 checkout: `~/Documents/code/kuma-mieru`
- Permanent `v2-dev` worktree: `~/Documents/code/kuma-mieru-v2-dev`
- Current implementation branch: `feat/v2-foundation`
- PR #470 repair worktree: `~/Documents/code/kuma-mieru-pr-470`

Do not implement v2 directly on `main`. The temporary feature branch must merge into `v2-dev`
after its release gates pass.

## Runtime boundary

- Bun is the package manager, task orchestrator, and v1 test runner.
- Node.js 24 or newer is the server runtime.
- Vite builds the React Router SPA.
- Hono serves the API and the production SPA output.
- SQLite stores schema migrations and managed configuration revisions.

`better-sqlite3` is deliberately executed under Node, not Bun. The current Bun N-API runtime can
crash while loading it, so v2 database tests also run against compiled Node output.

## Commands

```bash
bun install
bun run dev
bun run typecheck:v2
bun run lint
bun run test
bun run build
bun run start
```

The development command starts Vite on port `3881` and Hono on port `3882`. Vite proxies API and
health requests to Hono. The production command serves both API and SPA from the Hono process.

The old application remains available through `dev:v1`, `build:v1`, `start:v1`, and `test:v1`
during the compatibility period.

## Configuration modes

The startup loader produces one immutable runtime snapshot from one of three modes:

1. `managed`: default mode; creates or loads an active SQLite configuration revision.
2. `file`: set `KUMA_MIERU_CONFIG_MODE=file` and `KUMA_MIERU_CONFIG=/path/config.yml`.
3. `compatibility`: automatically selected when legacy Uptime Kuma environment variables exist,
   or explicitly selected with `KUMA_MIERU_CONFIG_MODE=compatibility`.

`UPTIME_KUMA_URLS` takes precedence over `UPTIME_KUMA_BASE_URL` plus `PAGE_ID`. Compatibility mode
does not write converted legacy configuration into the managed revision store.

## Migration invariants

Migration files use the form `000001_name.up.sql`. Startup rejects gaps, invalid names, missing
historical files, changed checksums, failed integrity checks, and failed foreign-key checks. Each
applied migration and its SHA-256 checksum are recorded in `schema_migrations`.

The current foundation slice does not yet implement authentication, source polling, incidents,
subscriptions, or configuration mutation APIs. Their public routes and control-plane capabilities
must remain disabled until the corresponding contracts and security gates are implemented.
