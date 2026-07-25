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

Before opening the application database or running migrations, the process acquires a private
SQLite lock database below `/data/.runtime`. One lifecycle-long `BEGIN EXCLUSIVE` makes the entire
data directory single-writer: a second Runtime, `migrate-v1 --execute`, or
`restore-backup --execute` fails closed instead of racing the active process. The lock uses operating
system SQLite file ownership rather than PID files or expiring heartbeats, so `SIGKILL` and container
crashes release it without a stale-lock override. Readiness includes
`runtimeOwnership: "exclusive"` and fails if the owning transaction is no longer held.

The Simple profile therefore runs exactly one application replica per data directory. The volume
must provide correct local/POSIX SQLite locking semantics; shared network filesystems that weaken
SQLite locking are unsupported. Horizontal availability requires a future external database/runtime
coordination profile, not multiple containers writing the same SQLite volume.

## Commands

```bash
bun install
bun run dev
bun run typecheck:v2
bun run lint
bun run test
bun run build
bun run verify:v2:bundle
bun run release:v2:manifest
bun run start
```

The development command starts Vite on port `3881` and Hono on port `3882`. Vite proxies API and
health requests to Hono. The production command serves both API and SPA from the Hono process.

The old application remains available through `dev:v1`, `build:v1`, `start:v1`, and `test:v1`
during the compatibility period.

The v2 test runner discovers every compiled `*.node.js` test recursively, so adding a test file
cannot silently omit it from CI. The checked-in `fixtures/v1-compatibility/environment-matrix.json`
is the reviewable Golden Matrix for legacy environment precedence and generated JSON projection.
After a production build, `verify:v2:bundle` enforces the 220 KiB gzip public-initial-JavaScript
budget and proves that the Admin chunk is not eagerly referenced. `release:v2:manifest` then emits
`dist/v2/release-manifest.json` with the source state, runtime contract, compatibility inventory,
Migration checksums, artifact hashes, and the explicit non-stable release channel. CI uses strict
mode, which refuses to create release evidence from a dirty checkout.

## Configuration modes

The startup loader produces one immutable runtime snapshot from one of three modes:

1. `managed`: default mode; creates or loads an active SQLite configuration revision.
2. `file`: set `KUMA_MIERU_CONFIG_MODE=file` and `KUMA_MIERU_CONFIG=/path/config.yml`.
3. `compatibility`: automatically selected when legacy Uptime Kuma environment variables exist,
   or explicitly selected with `KUMA_MIERU_CONFIG_MODE=compatibility`.

`UPTIME_KUMA_URLS` takes precedence over `UPTIME_KUMA_BASE_URL` plus `PAGE_ID`. Compatibility mode
does not write converted legacy configuration into the managed revision store.

File mode validates its initial sources before opening the public server. After startup, a
single-flight reloader combines `fs.watch` as an acceleration signal with an authoritative
10-second `stat` check. A changed file is read completely, hashed, parsed, validated with Zod, and
source-tested before a new immutable runtime snapshot replaces the previous one. Formatting-only
changes with the same canonical hash do not restart pollers.

`SIGHUP` and the Owner-only, recent-authentication-protected
`POST /api/v1/admin/config/reload` endpoint trigger the same validation path. The Admin overview
exposes the last success, stable error code, and failed candidate hash; the public metadata omits
the candidate hash. Partial writes, invalid schemas, unresolved Secret References, and failed
source dry-runs retain the last-known-good snapshot and active pollers.

Private, loopback, link-local, and reserved source addresses are blocked by default. Self-hosted
Uptime Kuma instances on a trusted private network require an explicit comma-separated CIDR list,
for example `KUMA_MIERU_PRIVATE_SOURCE_CIDRS=10.20.30.5/32,fd00:1234::/64`. A private address not
contained by that list is rejected; there is no global allow-all switch. Every request and redirect
target is resolved, validated, and pinned to its validated address set before connecting. URLs
containing credentials are always rejected.

### v1 compatibility migration

Compatibility startup classifies the complete v1 environment matrix. `UPTIME_KUMA_URLS` remains
higher priority than `UPTIME_KUMA_BASE_URL + PAGE_ID`; `KUMA_MIERU_*` remains higher priority than
its `FEATURE_*` fallback. Title, description, icon, Edit-this-page, Star button, and bounded request
timeout map into canonical v2 configuration. SSR-only or unsafe legacy switches are recorded as
`accepted_no_effect` with an explanation instead of becoming unknown-variable failures or silently
weakening the v2 security baseline.

`bun run migrate-v1 -- --dry-run` is the default, zero-write workflow. It reads the legacy
environment and optional `config/generated-config.json`, then reports Source/Page/Slug metadata,
precedence conflicts, ignored fields, Content Hash, parent Revision, and target Revision. Explicit
`--execute` runs checked SQLite migrations, creates a pre-import SQLite backup, preserves the v1
generated JSON, records any Schema Upgrade Backup ID and Manifest, writes a migration manifest, and
atomically activates a Managed Revision. The operator then sets
`KUMA_MIERU_CONFIG_MODE=managed`; keeping the old environment continues to select the read-only
Compatibility Profile until that explicit cutover.

The compatibility surface also preserves the v1 read routes `/api/config`, `/api/monitor`,
`/api/icon`, `/api/manage-status-page`, `/about`, and `/monitor/:monitorId`. Config and monitor
responses are projected exclusively from the local last-known-good snapshot; they never trigger an
upstream request from a visitor. An unavailable snapshot returns `503` with `Cache-Control:
no-store`, legacy responses carry deprecation metadata, and monitor links resolve into the canonical
v2 status page instead of maintaining a second public renderer. The icon route serves only the
packaged fallback within the 2 MiB limit, while the management redirect is derived from the active
validated Source rather than accepting an arbitrary request target.

### Rootless simple image

The v2 Dockerfile builds with Bun but runs on Node 24 as fixed UID/GID 10001. A dedicated
`runtime/v2` dependency manifest keeps Next.js and the v1 frontend graph out of the runtime image.
The Simple Compose profile applies a read-only root filesystem, `/tmp` tmpfs, the sole persistent
`/data` volume, `cap_drop: [ALL]`, `no-new-privileges`, PID/memory/CPU limits, health checks, and a
20-second graceful shutdown window. It does not mount a Docker socket or request host namespaces,
devices, privileged mode, or a writable Source mount.

The 2026-07-25 amd64 Docker drill produced a 74,913,128-byte image, ran as `10001:10001`, rejected a
root-filesystem write, accepted the `/data` write, returned schema version 13 from Readiness, and
exited with code 0 on Compose SIGTERM. It also proved that the runtime graph contains no Next.js,
production output contains no source maps, and all 141 files in the embedded Release Manifest match
their byte length and SHA-256. A deliberately mismatched `KUMA_MIERU_BUILD_VERSION=2.0.1` failed
before opening the listener.

### OpenGraph and rootless Edge profile

The SPA keeps a relative `./opengraph.png` meta tag. Hono canonicalizes configured status-page
refreshes to trailing-slash routes and serves page-specific 1200 by 630 PNGs for Overview, Metrics,
and Methodology views. Rendering accepts only the active validated Page and local last-known-good
snapshot. Takumi 2.4.2 uses local Noto Sans SC coverage subsets, a fixed node tree, two concurrent
unique renders, a five-second abort deadline, single-flight, a 128-entry LRU, strong ETags, and a
generated static fallback. Failed or load-shed renders are not stored as successful cache entries.

`docker compose -f docker-compose.edge.yml up -d --build` starts the same rootless application
behind an independently rootless `nginx-unprivileged` image. Only Edge publishes a host port. Nginx
adds canonical trailing-slash redirects, a bounded cache keyed without query strings, cache lock,
stale-on-error, and an internal static fallback. It resolves the application through Docker DNS at
request time, so Edge remains healthy and can serve cached or fallback images even when the
application container and its DNS record are absent.

The 2026-07-25 amd64 drill rendered a CJK page through the production Node 24 image with
`X-Kuma-Mieru-OG: rendered`; its PNG differed from the packaged fallback. Edge produced MISS then
HIT, survived a complete application stop, returned the byte-identical fallback for an uncached
view, and returned to MISS then HIT after application recovery. Both containers ran with explicit
non-root users, read-only root filesystems, all capabilities dropped, and no-new-privileges.
Multi-architecture release pulls, public TLS/CDN behavior, and long-running cache capacity remain
release-environment gates.

### Release identity and supply chain

`release/v2/release-spec.json`, rather than the compatibility-period root package version, is the
machine-readable v2 release identity. Version suffix, channel, SQLite schema range, runtime identity,
container constraints, and the v1 compatibility inventory are validated together. A production
build creates `dist/v2/release-manifest.json`; startup requires it, checks the build version before
opening the database, and checks the migrated schema before serving traffic. Public metadata exposes
the non-secret channel, source, and container evidence. A source archive without Git metadata still
builds an explicitly unverified local Manifest; strict release evidence rejects that fallback.

The release policy permits `v2-dev` to publish only `2-dev` plus an immutable commit tag. Alpha,
Beta, and RC tags publish only their exact version and commit tag. Only an exact Stable tag whose
commit is already in `main` may publish minor, major, and `latest` aliases. Pull requests and manual
dispatches build without pushing. Published multi-architecture images request BuildKit SPDX SBOM and
maximum provenance, GitHub provenance for the final manifest digest, and a Cosign keyless signature
of that same digest.

The remote 2026-07-25 OCI drill found two SLSA provenance statements and two SPDX statements bound
to the temporary validation digest. A real GHCR push, GitHub OIDC signature verification,
pull-by-digest on both architectures, and a Rootless Docker daemon remain release-environment
gates; local evidence does not claim those external gates are complete.

## SQLite backup and offline restore

Kuma Mieru creates a daily online SQLite backup by default. The scheduler can be disabled with
`KUMA_MIERU_BACKUP_SCHEDULE_ENABLED=false`; Owner-triggered backups remain available through the
Admin API. Backups live only below `/data/backups`, use fixed `bkp_<uuid>` identifiers, and consist
of a `0600` SQLite artifact plus a `0600` JSON Manifest. The Manifest binds the application build,
Schema version, byte size, and SHA-256 without exposing an absolute source path.

The Owner-only Admin surface can list backups, create one after recent authentication, and validate
a restore candidate. It never accepts an arbitrary filesystem path and never performs an online
restore. Backup creation uses SQLite's Online Backup API, checks free space, serializes concurrent
jobs through the catalog, validates the SQLite header, integrity, foreign keys, Migration Ledger,
size, and checksum, then atomically publishes the artifact. Interrupted `creating` rows are marked
failed at startup and only their exact `.partial` files are removed. Ready or failed backups are
never deleted automatically.

When an existing database has pending migrations, startup creates the same restore-compatible
Artifact before applying the first migration. Its Manifest uses `purpose: "schema-upgrade"`, records
the source and target Schema versions plus every pending Migration checksum, and is registered in
the backup catalog as soon as that table exists. Backup space, Header, Integrity, Foreign Keys,
Ledger, size, and SHA-256 must all pass before the Ledger can advance. A Schema Upgrade Artifact
does not satisfy the separate daily runtime-backup schedule.

Restore is an explicit offline operator workflow:

```bash
bun run restore-backup -- --backup-id bkp_<uuid> --data-dir ./data
bun run restore-backup -- --backup-id bkp_<uuid> --data-dir ./data --execute
```

The first command is a zero-write dry run. Before `--execute`, stop Kuma Mieru. Execution refuses a
data directory whose Runtime ownership lock is held, also refuses a database with WAL/SHM sidecars,
revalidates the fixed backup artifact, checks rollback space, copies and hashes a private candidate,
atomically replaces the database, and preserves the previous file as
`kuma-mieru.sqlite3.pre-restore-<timestamp>`. Start the same or newer compatible build afterward,
verify `/health/ready`, and retain the pre-restore file until the operator's rollback window ends.
The production image contains the same compiled CLI; a container deployment can invoke
`node dist/v2/server/cli/restore-backup.js --backup-id bkp_<uuid> --data-dir /data` from a one-off
container after the main service has stopped.

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

## Better Stack public adapter

The Better Stack adapter reads only the public `index.json` document and does not require a Team
Token. Its JSON:API-style status page, sections, resources, 90-day daily history, status reports,
and status updates are validated at the trust boundary and normalized through the same snapshot
store used by Uptime Kuma. Unknown Included resource types are ignored for forward compatibility;
known resource types with malformed fields reject the snapshot, and unknown service or aggregate
states become `unknown`, never `operational`. The provider's unspecific `availability` aggregate is
not mislabeled as the normalized 24-hour uptime value.

Source polling and Test Connection dispatch through a function-based Adapter Registry. Adding an
adapter no longer requires a provider-specific branch in the scheduler, and public requests still
read only the local last-known-good snapshot.

## Encrypted secret store

Private source and transport credentials are stored as opaque `secretRef` values. Secret values are
encrypted with AES-256-GCM using a fresh 96-bit nonce and authenticated binding metadata for the
resource ID, field name, and key ID. SQLite stores ciphertext only; metadata listing never returns
the ciphertext or plaintext, and consumers must resolve a reference with the exact expected
resource, field, and purpose.

Quickstart creates a rootless `0600` keyring at `/data/.secrets/keyring.json`. Hardened deployments
can mount a read-only keyring and set `KUMA_MIERU_MASTER_KEY_FILE`. A keyring declares one current
write key and may retain old read keys; the store can atomically re-encrypt old records before an
operator removes retired keys.

## UptimeRobot v3 adapter

The UptimeRobot adapter uses the official REST v3 surface with a scoped read-only Bearer JWT from
the encrypted Secret Store. It reads monitors and monitor groups only, requests at most 200 monitors
per page, and follows numeric cursors only after rebuilding them against the configured same-origin,
same-path endpoint. Repeated cursors, off-origin `nextLink` values, and more than 100 pages fail the
snapshot without replacing the last-known-good copy.

Monitor states, groups, tags, and the provider-defined 24-hour uptime histogram are normalized.
Unknown future states become `unknown`, response time remains empty rather than being mislabeled,
and no create, update, pause, or delete endpoint is called.

## incident.io public Widget adapter

The default incident.io adapter reads the unauthenticated, cacheable `GET /api/v1/summary` Widget
endpoint through the same SSRF boundary. It normalizes ongoing incidents, in-progress maintenance,
scheduled maintenance, and affected components. A scheduled maintenance does not degrade current
status before it begins, and unknown future impact values become `unknown`.

Widget mode deliberately advertises current events and maintenance only: it does not claim component
uptime or incident history, and it does not call any write endpoint. Internal incident.io Status
Pages and pages without Widget API access fail connection testing instead of falling back to HTML
scraping.

## LLM-Mieru read adapter

The LLM-Mieru adapter is the only native integration between the two independently deployable
products. It negotiates `/api/v1/meta`, then reads only the service catalog, current status
snapshot, and advertised optional incident endpoint. API major versions other than v1 fail with a
stable `unsupported_version` error and preserve the previous last-known-good snapshot.

Public LLM-Mieru instances need no credential. Private instances use a scoped read token stored by
the encrypted Secret Store; Provider keys, Agent credentials, Plan signing keys, and Admin tokens
are never accepted. Provider route, model, scenario, observed region, protocol version, freshness,
and raw status survive normalization as generic tags or Adapter-owned `extensions`. They do not add
LLM-specific fields to the Kuma Core schema. Missing or stale measurements and unknown future
status values become `unknown`, never `operational`.

The adapter follows the frozen LLM-Mieru Public API v1.0 producer shape rather than the earlier
draft-only Service schema. Current status expands each Provider Route and Requested Model into
region-scoped generic Services; non-active Coverage, stale evidence, and unknown states fail closed
to `unknown`. Automatic incidents remain read-only Source evidence and do not enter Kuma's native
Publication or notification Outbox.

When the Producer advertises both `metric-catalog` and `metric-query`, a bounded background
extension refresh reads the generic Catalog and Series for the versioned
`5m | 1h | 1d | 7d | 30d` windows. Refresh cadence is tiered at five minutes, fifteen minutes, one
hour, six hours, and twenty-four hours respectively. Each source poll refreshes at most two due
windows, preferring missing windows in stable short-to-long order; a failure in one window neither
blocks another nor replaces its last-known-good cache. Migration 9 preserves the Migration 8 cache
as the `5m` window while extending the primary key with the window dimension.

Public Catalog/Query endpoints and the lazy `/status/:pageSlug/metrics` Explorer read only those
local caches, expose Sample Count, Coverage, Freshness, Limitations, Unit and arbitrary Dimension
Maps, and never fan out to LLM-Mieru from a visitor request. Recharts remains isolated in the Metric
Explorer chunk; instances without a native Metric Source do not show the route entry or download
the chart dependency.

When the Producer advertises `methodology`, the poller separately caches the versioned methodology
snapshot once per hour with a three-hour freshness boundary. The public
`/api/v1/public/pages/:slug/methodology` endpoint and lazy
`/status/:pageSlug/methodology` disclosure page preserve protocol, metric, coverage, limitation,
and evidence fields from the same local snapshot. Stale disclosure remains visible as explicit
last-known-good evidence.

Successful source polls now reconcile normalized Incident and Maintenance evidence into the
Migration 10 Mirrored Event ledger. Identity is stable across polls by Source, Source Page, Event
Kind, and upstream Event ID. A changed payload, disappearance from an authoritative current/history
feed, or later reappearance appends a new sequence; an unchanged poll only advances `lastSeenAt`.
Disappearance is represented as `absent`, never rewritten into a fictional `resolved` Native Event.

Mirrored Events have dedicated Public and Admin read APIs and a visibly read-only surface in both
workbenches. They retain the upstream ID, sanitized source link, fetch time, source update time, raw
status, and immutable observation timeline. Public responses redact the Source Base URL by default
to avoid exposing private topology; authenticated Admin reads receive only a URL with credentials,
query, and fragment removed. The mirror repository has no Publication or Notification Outbox write
path, and the Public UI explicitly labels these records as ineligible for secondary notifications.

Migration 11 adds the separate Signal Automation ledger. Each new successful Source snapshot stores
one idempotent `SignalObservation` per mapped Page and Service, then evaluates the fixed
`signal-suggest-v1` rule. The backward-compatible default is `suggest-draft`: three consecutive
degraded/partial/major observations create a private degradation suggestion, while two consecutive
operational observations can create a recovery suggestion for an accepted native incident.
Maintenance is suppressed, unknown/pending/paused evidence cannot create a suggestion, stale
snapshots do not advance the counter, and an ignored suggestion starts a bounded cooldown.

Every evaluation records its Rule Version, thresholds, evidence and decision. Suggestions are
visible to all Admin roles, but only Owner/Publisher/Editor can accept or ignore them through
same-origin CSRF-protected mutations. Accepting degradation creates an unpublished Native Incident
draft; accepting recovery appends an unpublished resolved update only after the linked Native Event
version is reviewed explicitly. Neither path creates a Publication or Notification Outbox item.
There is no `auto_publish` runtime mode in this foundation slice.

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
responsive workbench. Its Event desk creates append-only Incident drafts and updates, then gives
Owner/Publisher sessions a separate review-and-publish step with an explicit notification choice.
Forms use React Hook Form and Zod at the client boundary; server validation remains authoritative.

Write controls are rendered only for Owner or Editor sessions in managed mode. Publisher and Viewer
sessions, as well as file and compatibility mode, receive an explicit read-only surface. Rollback is
visible only to an Owner in managed mode. Expired sessions return to the sign-in boundary rather
than leaving stale privileged controls on screen.

## Native incidents and public delivery

Native Incident commands use an append-only aggregate ledger. Creation requires an Idempotency Key;
updates require an Expected Version and reject stale writers or invalid backwards state transitions.
Publishing never exposes a mutable draft. It creates an immutable Publication content snapshot,
Admin Audit entry, subscriber scope snapshot, and notification Outbox work in one SQLite
transaction.

Publishers must first obtain a five-minute Review Nonce bound to the actor, session, event version,
explicit `notifySubscribers` choice, and estimated recipient count. A changed version, notification
choice, session, or recipient count invalidates the publish request. Public Incident JSON, RSS 2.0,
and Atom 1.0 are projected only from Publications; RSS and Atom support ETag revalidation.

Email subscription requests use a page-bound short-lived nonce, honeypot, page/email rate limits,
and a response that does not reveal whether an address exists. Normalized email addresses are
encrypted with AES-256-GCM and deduplicated with a keyed HMAC. Confirmation, management, and
unsubscribe tokens contain at least 256 random bits; SQLite stores only keyed token hashes. GET on a
confirmation token is read-only, while POST performs activation. Token routes are `no-store`, use a
no-referrer policy, and have a restrictive CSP.

The transactional delivery worker claims bounded batches, recovers stale locks, uses stable Message
IDs, adds one-click unsubscribe headers, retries transient SMTP failures with bounded exponential
backoff, and moves permanent or exhausted work to Dead-letter. Nodemailer is isolated behind a
functional transport interface; SMTP connection verification and TLS 1.2 minimums are implemented.
The worker starts only after a structured SMTP configuration and its bound Secret References resolve
successfully. Reconfiguration starts the replacement worker before closing the previous pool; a
failed active configuration stops delivery and exposes only a low-cardinality error code.

Managed mode gives the Owner a stage → verify → activate workflow. Credentials are encrypted as a
new immutable credential set, SMTP `verify()` returns a five-minute token bound to the complete
candidate, and only that exact candidate can create the next Config Revision. The Admin API and UI
never return credential values; the staging response returns new opaque Secret References once so
the caller can bind that candidate. Persisted configuration reads redact those references.
Publisher can inspect the redacted transport and runtime state, while only Owner with recent
authentication can stage credentials, verify, activate, disable, or send an explicit real test
message.

File mode accepts the same canonical shape and verifies enabled SMTP during dry-run before a hot
reload can replace the last-known-good snapshot. Both modes require an explicit
`server.publicBaseUrl`, use STARTTLS or implicit TLS, reject invalid certificates, require TLS 1.2 or
newer, and keep public email subscription endpoints disabled unless the delivery runtime is
actually running. SMTP authentication is optional; when used, the credential set ID and its two
bound Secret References must be present together. A File Mode operator stages a credential set
through the Owner API, copies the one-time returned references into the protected YAML, and then
reloads; credentials themselves never enter that file.

```yaml
schemaVersion: 1
server:
  publicBaseUrl: https://status.example.com
delivery:
  smtp:
    enabled: true
    host: smtp.example.com
    port: 587
    tls: starttls
    from:
      address: status@example.com
      name: Example Status
    replyTo: support@example.com
    credentialSetId: smtp_example
    usernameRef: sec_example_username
    passwordRef: sec_example_password
```

The Subscriber dashboard is available only to Owner and Publisher. Its API returns a one-way
private recipient fingerprint instead of an address, hash, ciphertext, token, or message payload.
Failed and Dead-letter delivery can return to the queue only while the subscriber lifecycle still
permits that message kind; retry resets the bounded attempt counter and writes an Admin Audit entry.
Owner suppression uses an Expected State precondition, atomically suppresses the subscriber, stops
pending event-publication mail, and cannot reactivate an address without a new consent workflow.

## Native maintenance windows

Maintenance uses the same append-only Domain Event, Publication Review, subscriber scope snapshot,
transactional Outbox, and Admin Audit core as Incident without pretending to be an Incident. Its
state machine is `draft → scheduled → in_progress → completed/cancelled`; backwards transitions,
stale Expected Versions, invalid time windows, and duplicate publication of one sequence are
rejected.

Each version retains its scheduled start/end, affected components, occurrence time, record time,
and actor. Published maintenance appears in the page RSS/Atom feed and the dedicated public
maintenance API. Email remains an explicit Boolean on every reviewed publication; no state change
inherits a previous notification choice. The backend Admin API is available in this slice, while
the unified Event Workbench now provides the dedicated Maintenance editor. Automatic start/end
scheduling remains disabled.

## Native notices

Notice is a separate append-only aggregate for non-incident communication. It uses
`draft → published → expired/withdrawn`, an `information | warning` kind, and an optional display
window that is validated whenever it changes. Publishing a Notice does not mutate Component or
Overall Status and cannot masquerade as Incident history.

Notice creation, update, review, explicit notification choice, public read API, and RSS/Atom
projection use the shared native-event transaction core. The unified Event Workbench now provides
the dedicated Notice editor. Automatic expiry scheduling remains disabled.

## Postmortem core

Postmortem is an append-only child aggregate of Incident. Creation is rejected until the parent
Incident is `resolved`; Page, affected components, and incident-scoped subscriber eligibility are
inherited from that parent. Its `draft → reviewed → published` transitions, Expected Version,
Publication Review, explicit notification choice, Outbox transaction, and Feed link use the shared
native-event core. Admin creation/update/review/publication and the Incident-scoped Public API are
available through the unified Event Workbench. Publication is rejected until the aggregate reaches
its final `published` state.

## Migration invariants

Migration files use the form `000001_name.up.sql`. Startup rejects gaps, invalid names, missing
historical files, changed checksums, failed integrity checks, and failed foreign-key checks. Each
applied migration and its SHA-256 checksum are recorded in `schema_migrations`.

The current implementation does not yet provide passkey enrollment UI, identity administration,
or automatic Maintenance/Notice schedulers. Their control-plane capabilities must remain disabled
until the corresponding contracts and security gates are implemented.
