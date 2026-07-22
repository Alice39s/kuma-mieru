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

Private, loopback, link-local, and reserved source addresses are blocked by default. Self-hosted
Uptime Kuma instances on a trusted private network require
`KUMA_MIERU_ALLOW_PRIVATE_SOURCES=true`. Redirect targets are validated again and URLs containing
credentials are always rejected.

## Uptime Kuma public adapter

The v1/v2 adapter only reads the public status-page and heartbeat endpoints. It never connects to
the management Socket.IO API or an upstream database. A background poller validates responses with
Zod, normalizes groups, monitors, tags, heartbeat state, latency, uptime, and active incidents, then
writes an immutable last-known-good snapshot to SQLite.

Public requests read `/api/v1/public/pages/:slug/snapshot` from local SQLite. They return `503` with
`Retry-After` until the first snapshot exists and never fall back to a visitor-triggered upstream
request. Failed refreshes retain the previous snapshot with explicit stale health metadata.

The HTTP boundary enforces protocol and credential rules, DNS-based private-address blocking,
redirect revalidation, a 10-second timeout, a three-redirect limit, a 2 MiB decompressed-body limit,
JSON content type, and conditional `ETag`/`Last-Modified` requests.

## Authentication and managed revisions

Better Auth is mounted at `/api/auth/*` with public sign-up disabled. The first startup with no users
creates a 15-minute, single-use Owner setup token. Only its SHA-256 hash is stored in SQLite; the
plaintext token is printed once at startup. Set `KUMA_MIERU_SETUP_TOKEN` to provide it through the
deployment secret store instead. Completing bootstrap creates one Owner credential account and
permanently closes the endpoint.

When `KUMA_MIERU_AUTH_SECRET` is absent, Kuma Mieru creates a rootless `0600` secret file inside the
data directory. Production deployments should set `KUMA_MIERU_BASE_URL` and, when needed, the
comma-separated `KUMA_MIERU_TRUSTED_ORIGINS` explicitly.

Admin JSON mutations require all of the following: a Better Auth session, an allowed role, an exact
trusted Origin, `Sec-Fetch-Site: same-origin`, a session-bound `X-Kuma-CSRF` token, JSON content type,
and a 256 KiB body limit. High-risk rollback additionally requires a session created in the last
five minutes.

Managed configuration writes use an Expected Revision. The new immutable Revision, Active Pointer,
and redacted Admin Audit summary are committed in one SQLite transaction. A stale Expected Revision
returns a conflict without changing configuration. Rollback creates a new Revision and never
reactivates or deletes historical rows.

Source creation and modification require a successful `/api/v1/admin/sources/test` result. Its
five-minute HMAC token is bound to the complete validated Source, so changing the base URL or page
selection invalidates the save request. Test Connection never activates the draft configuration.

## Admin workbench

`/admin` is a separately lazy-loaded React Router surface and is not nested inside the public
status-page shell. First-run setup, email/password recovery sign-in, session discovery, source
verification, page composition, revision history, and owner rollback are available through one
responsive workbench. Forms use React Hook Form and Zod at the client boundary; server validation
remains authoritative.

Write controls are rendered only for Owner or Editor sessions in managed mode. Publisher and Viewer
sessions, as well as file and compatibility mode, receive an explicit read-only surface. Rollback is
visible only to an Owner in managed mode. Expired sessions return to the sign-in boundary rather
than leaving stale privileged controls on screen.

## Migration invariants

Migration files use the form `000001_name.up.sql`. Startup rejects gaps, invalid names, missing
historical files, changed checksums, failed integrity checks, and failed foreign-key checks. Each
applied migration and its SHA-256 checksum are recorded in `schema_migrations`.

The current implementation does not yet provide passkey enrollment UI, identity administration,
native incident publishing, subscriptions, or delivery outbox workers. Their control-plane
capabilities must remain disabled until the corresponding contracts and security gates are
implemented.
