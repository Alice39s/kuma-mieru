# Kuma Mieru :traffic_light:

**Kuma Mieru - A Modern Third-Party Monitoring Dashboard for Uptime Kuma**  
Built with Next.js 16, TypeScript, and Recharts, this project enhances Uptime Kuma's public status pages with intuitive visualizations and latency charts.

[中文版](README.md) | English Version

> [!WARNING]
> New version (v1.1.4+) has refactored the time processing logic,
>
> please note to modify the `Display Timezone` (Display Timezone) to `UTC+0` time zone in the _Uptime Kuma_ settings.

<div align="center">
<!-- Release -->

[![Release](https://img.shields.io/github/v/release/Alice39s/kuma-mieru?style=flat-square&color=blue&label=Release)](https://github.com/Alice39s/kuma-mieru/releases/latest) [![License](https://img.shields.io/github/license/Alice39s/kuma-mieru?style=flat-square&color=blue)](https://github.com/Alice39s/kuma-mieru/blob/main/LICENSE)  
[![Workflow](https://img.shields.io/github/actions/workflow/status/Alice39s/kuma-mieru/release.yml?branch=main&style=flat-square&logo=github&label=Workflow)](https://github.com/Alice39s/kuma-mieru/actions/workflows/release.yml) [![Docker](https://img.shields.io/github/actions/workflow/status/Alice39s/kuma-mieru/docker-build.yml?branch=main&style=flat-square&logo=docker&label=Docker)](https://github.com/Alice39s/kuma-mieru/actions/workflows/docker-build.yml)

<!-- Project Data -->

[![Stars](https://img.shields.io/github/stars/Alice39s/kuma-mieru?style=flat-square&logo=github&color=yellow&label=Stars)](https://github.com/Alice39s/kuma-mieru/stargazers) [![Forks](https://img.shields.io/github/forks/Alice39s/kuma-mieru?style=flat-square&logo=github&color=yellow&label=Forks)](https://github.com/Alice39s/kuma-mieru/network/members)

<!-- Tech Stack -->

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/) [![React](https://img.shields.io/badge/React-v19-387CA0?style=flat-square&logo=react&logoColor=white)](https://reactjs.org/) [![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js&logoColor=white)](https://nextjs.org/)  
[![Bun](https://img.shields.io/badge/Bun-Package%20Manager-14151A?style=flat-square&logo=bun&logoColor=white)](https://bun.sh/) [![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-v4-4EB9FA?style=flat-square&logo=tailwind-css&logoColor=white)](https://v4.tailwindcss.com/)

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/Alice39s/kuma-mieru)

</div>

## Table of Contents

- [Kuma Mieru :traffic_light:](#kuma-mieru-traffic_light)
  - [Table of Contents](#table-of-contents)
  - [Key Features :sparkles:](#key-features-sparkles)
  - [Preview :camera:](#preview-camera)
  - [Deployment :star:](#deployment-star)
    - [Vercel Deployment (Recommended)](#vercel-deployment-recommended)
      - [1. Fork Repository](#1-fork-repository)
      - [2. Import to Vercel](#2-import-to-vercel)
      - [3. Configure Environment Variables](#3-configure-environment-variables)
      - [4. Update Repository](#4-update-repository)
    - [Cloudflare Workers Deployment](#cloudflare-workers-deployment)
    - [Local Installation](#local-installation)
  - [Docker Deployment :whale: (Beta)](#docker-deployment-whale-beta)
    - [Using Docker Compose (Recommended)](#using-docker-compose-recommended)
    - [Manual Docker Deployment](#manual-docker-deployment)
      - [1. Pull Container Image](#1-pull-container-image)
        - [Pull from GHCR (Recommended)](#pull-from-ghcr-recommended)
      - [2. Modify Environment Variables](#2-modify-environment-variables)
      - [3. Start Container Service](#3-start-container-service)
        - [Using GHCR Image](#using-ghcr-image)
  - [Version Strategy](#version-strategy)
  - [Upgrading from v1 to v2 (2.0.0-alpha)](#upgrading-from-v1-to-v2-200-alpha)
  - [Environment Variables](#environment-variables)
  - [Integration with Uptime Kuma :link:](#integration-with-uptime-kuma-link)
  - [FAQ :question:](#faq-question)
    - [Why is the time I see in Kuma Mieru offset from the time I see in Uptime Kuma?](#why-is-the-time-i-see-in-kuma-mieru-offset-from-the-time-i-see-in-uptime-kuma)
    - [Is Uptime Robot / Better Stack / other monitoring data sources compatible?](#is-uptime-robot--better-stack--other-monitoring-data-sources-compatible)
  - [Contribution Guide :handshake:](#contribution-guide-handshake)
  - [Star History :star2:](#star-history-star2)
  - [License :lock:](#license-lock)

## Key Features :sparkles:

- **Real-Time Monitoring & Auto-Refresh** :arrows_clockwise: Live status updates without manual refreshing.
- **Elegant Responsive UI** :art: Modern interface powered by **HeroUI components**, optimized for all devices.
- **Interactive Analytics** :chart_with_upwards_trend: Explore node latency/status data through **Recharts-powered visualizations**.
- **Multi-Theme Support** :bulb: Dark/Light/System themes with automatic detection.
- **Maintenance Announcements**: Native support for Uptime Kuma's **incident updates** and **status events**.

## Preview :camera:

| Dark Mode                               | Light Mode                                |
| --------------------------------------- | ----------------------------------------- |
| ![Dark Mode](./docs/v1.2.1-dark-en.png) | ![Light Mode](./docs/v1.2.1-light-en.png) |

## Deployment :star:

### Vercel Deployment (Recommended)

#### 1. Fork Repository

1. Click [Fork](https://github.com/Alice39s/kuma-mieru/fork) button to fork this repository to your GitHub account.
2. Click `Create fork` button to create a new fork.

> [!NOTE]
> Please ensure your forked repository is public, otherwise you may encounter issues when synchronizing updates.
>
> Your configuration is stored in environment variables, so your forked repository will not leak any configuration information.

#### 2. Import to Vercel

Go to <https://vercel.com/new>, select **Import** to import the repository you just forked.

#### 3. Configure Environment Variables

> [!NOTE]
> Please configure `UPTIME_KUMA_URLS` (recommended), otherwise monitoring data will not be displayed correctly.
>
> Legacy `UPTIME_KUMA_BASE_URL` + `PAGE_ID` is still supported. See [Environment Variables](#environment-variables) for details.

1. Click `Environment Variables` and add `UPTIME_KUMA_URLS` (recommended).

2. Click the `Deploy` button to deploy instantly on Vercel.

#### 4. Update Repository

1. Enter your forked GitHub repository, click the `Sync fork` button.
2. Click the `Update branch` button, and follow the prompts to automatically synchronize the latest code from this repository.

### Cloudflare Workers Deployment

> [!WARNING]
> Cloudflare Workers deployment is not supported yet, it is recommended to use [Vercel Deployment](#vercel-deployment-recommended) / Netlify instead.
>
> References: [#88](https://github.com/Alice39s/kuma-mieru/issues/88#issuecomment-2919619066)

~~Similar to [Vercel Deployment](#vercel-deployment-recommended), you can deploy to Cloudflare by importing the repository to Cloudflare.~~

~~Note:~~

~~1. Please use `bun run deploy:cloudflare` as the `Build command`, otherwise the deployment will fail.~~
~~2. Please ensure that the environment variables are configured, please refer to the [Environment Variables](#environment-variables) section for more details.~~

### Local Installation

1. **Clone Repository**

   ```bash
   git clone https://github.com/Alice39s/kuma-mieru.git
   cd kuma-mieru
   ```

2. **Install Dependencies**

   Kuma Mieru uses [Bun](https://bun.sh/) as its package manager, please install Bun first:

   ```bash
   # Linux/macOS
   curl -fsSL https://bun.sh/install | bash
   # Windows
   powershell -c "irm bun.sh/install.ps1 | iex"
   ```

   Then install the dependencies:

   ```bash
   bun install
   ```

3. **Configure Environment**  
   Copy `.env.example` to `.env` and modify:

   ```bash
   UPTIME_KUMA_URLS=https://your-kuma-instance.com/status/your_status_page_id
   ```

   _Multiple pages example:_

   ```bash
   UPTIME_KUMA_URLS=https://status.kuma-mieru.invalid/status/prod|https://status.kuma-mieru.invalid/status/staging
   ```

4. **Start Development Server**

   ```bash
   bun run dev
   ```

   Access at: [http://localhost:3883](http://localhost:3883)

5. **Production Build**

   ```bash
   bun run build
   bun run start
   ```

## Docker Deployment :whale: (Beta)

### Using Docker Compose (Recommended)

1. **Clone Repository**

   ```bash
   git clone https://github.com/Alice39s/kuma-mieru.git
   cd kuma-mieru
   ```

2. **Configure Environment Variables**  
   Duplicate the `.env.example` file to create your `.env` file:

   ```bash
   cp .env.example .env
   ```

   Edit the `.env` file with required configurations:

   ```
   UPTIME_KUMA_URLS=https://example.kuma-mieru.invalid/status/your-status-page-id
   ```

3. **Start Services**

   ```bash
   docker compose up -d
   ```

   Service will be available at `http://0.0.0.0:3883`.

4. **View Logs**

   ```bash
   docker compose logs -f
   ```

5. **Update Image**

   ```bash
   docker compose pull
   docker compose up -d
   ```

### Manual Docker Deployment

#### 1. Pull Container Image

##### Pull from GHCR (Recommended)

```bash
docker pull ghcr.io/alice39s/kuma-mieru:1
```

#### 2. Modify Environment Variables

Copy `.env.example` file to create your `.env` file:

```bash
cp .env.example .env
```

Please refer to the [Environment Variables](#environment-variables) section for more details, and prioritize configuring the `UPTIME_KUMA_URLS` variable in `.env`.

#### 3. Start Container Service

##### Using GHCR Image

```bash
docker run -d \
  --name kuma-mieru \
  -p 3883:3000 \
  -e UPTIME_KUMA_URLS="https://example.kuma-mieru.invalid/status/default|https://example.kuma-mieru.invalid/status/secondary" \
  -e KUMA_MIERU_TITLE="Kuma Mieru" \
  ghcr.io/alice39s/kuma-mieru:1
```

## Version Strategy

> [!WARNING]
> Docker image recommends using `ghcr.io/alice39s/kuma-mieru:1` (major version channel).
>
> Forward compatibility will be maintained as much as possible within `v1` major version; `v2` will be a version containing major Breaking Changes.
>
> Pinning to minor/patch versions (e.g., `:1.6` or `:1.6.2`) is not recommended unless you have a clear canary and rollback strategy.

## Upgrading from v1 to v2 (2.0.0-alpha)

v2 is a major release with several Breaking Changes. The current release is `2.0.0-alpha.1`, intended to gather feedback and **not recommended for production**. If you choose to upgrade, review the checklist below item by item.

### Must read: remote image domain policy tightened by default

This is the change most likely to affect existing deployments.

| Item | v1 (1.x) | v2 (2.0.0-alpha) |
| --- | --- | --- |
| Env var | `STRICT_IMAGE_REMOTE_PATTERNS` (default `false` = allow all domains) | `ALLOW_ANY_IMAGE_REMOTE_PATTERNS` (default `false` = **only build-time generated domains**) |
| SVG icons | `dangerouslyAllowSVG: true` (allowed) | `dangerouslyAllowSVG: false` (**blocked**) |
| Image proxy redirects | followed | `maximumRedirects: 0` (**not followed**) |

**If you dynamically switch the Uptime Kuma domain at Docker runtime**, images may fail to load after upgrading. Two options:

1. (Recommended) Keep the strict default and let `generate-image-domains` collect every needed domain at build time via `UPTIME_KUMA_URLS`.
2. (Not recommended) Set `ALLOW_ANY_IMAGE_REMOTE_PATTERNS=true` to restore the v1 permissive behavior.

### HeroUI dependency rollback (fixes #469)

Dependabot previously bumped `@heroui/react` to v3 (incompatible with the existing v2 component code, breaking the build in #469). v2 rolls it back to `^2.8.10` and freezes `@heroui/*` major bumps via dependabot config. If you manage dependencies in your own fork, do not let `@heroui/react` upgrade to v3 unless you have completed the HeroUI v3 migration.

### Behavior changes (may affect monitoring / API consumers)

- **pageId query param allowlist**: `/api/config`, `/api/monitor`, `/api/manage-status-page` now validate `pageId` against the configured list. Passing an unknown pageId falls back to the default page instead of being forwarded verbatim.
- **API error responses no longer leak internals**: `createApiResponse` returns a fixed `'Internal Server Error'` string on 500 errors instead of echoing the raw error message (to avoid leaking internals). External scripts parsing this field will see the change.
- **Icon proxy byte-stream hard limit**: `/api/icon` now enforces `maxResponseBytes` (2MB) while reading the stream, instead of relying solely on the spoofable/absent `Content-Length` header. Oversized icons are aborted.
- **Build script execution**: `scripts/banner.ts` now only prints under `import.meta.main` (i.e. when executed as a script); importing it as a library no longer has side effects.
- **pageId character validation**: pageIds containing `/ ? # \` in `UPTIME_KUMA_URLS` now fail at build time instead of being silently trimmed.

### Internal changes (usually invisible, but relevant for forks)

- Introduced zod schemas for runtime validation at data boundaries (preload-data, uptime-kuma API responses, etc.).
- Split several "god files" into smaller, testable modules (e.g. `fetch.ts` → `custom-fetch-core` + `request-policy`).
- The project now ships its first tests (node:test, ~20 test files).
- Multiple server-only modules are marked with `import 'server-only'` to prevent accidental client bundling.

### How to go back to v1

If v2-alpha causes issues, you can temporarily stay on the v1 stable line:

- Docker: use `ghcr.io/alice39s/kuma-mieru:1` instead of `:2` or `:latest`.
- Vercel/self-build: roll the repo back to the `1.7.3` tag.

## Environment Variables

First, assume your Uptime Kuma status page URL is:

`https://example.kuma-mieru.invalid/status/test1`

Recommended:

`UPTIME_KUMA_URLS=https://example.kuma-mieru.invalid/status/test1`

For multiple status pages, separate full URLs with `|`:

`UPTIME_KUMA_URLS=https://example.kuma-mieru.invalid/status/test1|https://example.kuma-mieru.invalid/status/test2`

Environment variables (including backward compatibility):

| Variable Name                   | Required | Description                                                                                                          | Example                                                                                                    |
| ------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| UPTIME_KUMA_URLS                | Yes\*    | Recommended. Full status page URL(s), supports `\|` separated multiple URLs (can come from different Kuma instances) | <https://example.kuma-mieru.invalid/status/default\|https://example.kuma-mieru.invalid/status/secondary>   |
| UPTIME_KUMA_BASE_URL            | Yes\*    | Legacy. Base URL of Uptime Kuma instance (used only when `UPTIME_KUMA_URLS` is not set)                              | <https://example.kuma-mieru.invalid>                                                                       |
| PAGE_ID                         | Yes\*    | Legacy. Status page IDs, comma-separated and first value is default (used only when `UPTIME_KUMA_URLS` not set)      | default,status-asia                                                                                        |
| KUMA_MIERU_EDIT_THIS_PAGE       | No       | Show "Edit This Page" button (new variable name)                                                                     | false                                                                                                      |
| KUMA_MIERU_SHOW_STAR_BUTTON     | No       | Show "Star on GitHub" button (new variable name)                                                                     | true                                                                                                       |
| KUMA_MIERU_TITLE                | No       | Custom page title (new variable name)                                                                                | My Monitoring Dashboard                                                                                    |
| KUMA_MIERU_DESCRIPTION          | No       | Custom page description (new variable name)                                                                          | A beautiful monitoring dashboard                                                                           |
| KUMA_MIERU_ICON                 | No       | Custom page icon URL (new variable name)                                                                             | /icon.svg                                                                                                  |
| FEATURE_EDIT_THIS_PAGE          | No       | Legacy alias of `KUMA_MIERU_EDIT_THIS_PAGE`                                                                          | false                                                                                                      |
| FEATURE_SHOW_STAR_BUTTON        | No       | Legacy alias of `KUMA_MIERU_SHOW_STAR_BUTTON`                                                                        | true                                                                                                       |
| FEATURE_TITLE                   | No       | Legacy alias of `KUMA_MIERU_TITLE`                                                                                   | My Monitoring Dashboard                                                                                    |
| FEATURE_DESCRIPTION             | No       | Legacy alias of `KUMA_MIERU_DESCRIPTION`                                                                             | A beautiful monitoring dashboard                                                                           |
| FEATURE_ICON                    | No       | Legacy alias of `KUMA_MIERU_ICON`                                                                                    | /icon.svg                                                                                                  |
| ALLOW_INSECURE_TLS              | No       | Whether to skip HTTPS certificate validation when requesting upstream Uptime Kuma (trusted self-signed only)         | `false` (default, strict validation) / `true` (skip validation, security risk)                             |
| REQUEST_TIMEOUT_MS              | No       | Global upstream request timeout (milliseconds, default 8000)                                                         | `8000`                                                                                                     |
| REQUEST_RETRY_MAX               | No       | Global upstream request max retry count (default 3)                                                                  | `3`                                                                                                        |
| REQUEST_RETRY_DELAY_MS          | No       | Global upstream request retry base interval (milliseconds, default 500)                                              | `500`                                                                                                      |
| SSR_STRICT_MODE                 | No       | Enable strict SSR failure mode (trigger global error page when all pages fail)                                       | `true` / `false` (default)                                                                                 |
| NEXT_PUBLIC_ERROR_PAGE_DEV_MODE | No       | Whether to show full stack trace in error page                                                                       | `false` (default) / `true`                                                                                 |
| ALLOW_EMBEDDING                 | No       | Whether to allow embedding in iframe (applies at runtime; no image rebuild needed)                                   | `false` (block) / `true` (allow all, not recommended) / `example.com,app.com` (whitelist)                  |
| ALLOW_ANY_IMAGE_REMOTE_PATTERNS | No       | Relax `next/image` remote image domain restrictions (build-time, not recommended)                                    | `false` (default, allow only domains generated by image-domains) / `true` (allow all remote image domains) |

\* Use either `UPTIME_KUMA_URLS` or `UPTIME_KUMA_BASE_URL + PAGE_ID`. If both are set, `UPTIME_KUMA_URLS` takes precedence.

After editing `.env`, run `docker compose up -d --force-recreate` so the container picks up updated environment variables.

> [!WARNING]
> By default, `next/image` allows only remote image domains generated by `generate-image-domains` at build time.
> If you need to support remote image domains that are only known at Docker runtime, set `ALLOW_ANY_IMAGE_REMOTE_PATTERNS=true` to relax the restriction. This expands the remote image optimization surface and is not recommended for high-security environments.

## Integration with Uptime Kuma :link:

> [!NOTE]
> For the latest stable version of Uptime Kuma (v1.23.0+), Kuma Mieru has been fully tested and is compatible.
>
> If you are using an older version, please refer to the [Uptime Kuma official documentation](https://github.com/louislam/uptime-kuma/wiki/%F0%9F%86%99-How-to-Update) to try to upgrade to the latest stable version (v1.23.0+), and remember to back up your data.

Seamlessly works with the popular self-hosted monitoring tool:  
[Uptime Kuma](https://github.com/louislam/uptime-kuma)

**Prerequisites**:

1. A running Uptime Kuma instance
2. Change `Display Timezone` to any `UTC+0` time zone in the Uptime Kuma settings.
3. Created status page in Uptime Kuma
4. Correct environment variables configuration

## FAQ :question:

### Why is the time I see in Kuma Mieru offset from the time I see in Uptime Kuma?

Since the time passed from the Uptime Kuma backend to the frontend **doesn't carry time zone information**, Kuma Mieru **automatically converts the time to the UTC+0 time zone** and displays it in order to facilitate development.

If you find that the time zone is shifted, please go to Uptime Kuma settings and change `Display Timezone` to any `UTC+0` time zone.

### Is Uptime Robot / Better Stack / other monitoring data sources compatible?

Kuma Mieru was designed to address the shortcomings of Uptime Kuma, so v1 does not consider supporting other monitoring data sources for now.

However, v2 may consider to support API interface of other monitoring tools such as Uptime Robot / Better Stack.

## Contribution Guide :handshake:

We welcome contributions! Please review:  
[CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## Star History :star2:

<a href="https://github.com/Alice39s/kuma-mieru/stargazers" target="_blank" style="display: block" align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Alice39s/kuma-mieru&type=Timeline&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Alice39s/kuma-mieru&type=Timeline" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Alice39s/kuma-mieru&type=Timeline" />
  </picture>
</a>

## License :lock:

Open-sourced under [MPL-2.0](LICENSE) (Mozilla Public License 2.0).
