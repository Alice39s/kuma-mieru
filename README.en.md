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

- [Kuma Mieru :traffic\_light:](#kuma-mieru-traffic_light)
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
    - [Environment Variables](#environment-variables)
    - [Health Check](#health-check)
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
> Please ensure you have configured the `UPTIME_KUMA_BASE_URL` and `PAGE_ID` environment variables, otherwise the monitoring data will not be displayed correctly.
>
> For more information about the `UPTIME_KUMA_BASE_URL` and `PAGE_ID` configuration, please refer to the [Environment Variables](#environment-variables) section.

1. Click `Environment Variables` to add the following two environment variables:  
   `UPTIME_KUMA_BASE_URL` and `PAGE_ID`.

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
   UPTIME_KUMA_BASE_URL=https://your-kuma-instance.com
   PAGE_ID=your_status_page_id
   ```

   _Example: For URL `https://status.kuma-mieru.invalid/status/prod`, set:  
   `UPTIME_KUMA_BASE_URL=https://status.kuma-mieru.invalid`  
   `PAGE_ID=prod`_

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
   UPTIME_KUMA_BASE_URL=https://example.kuma-mieru.invalid
   PAGE_ID=your-status-page-id
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

1. **Pull Image from GHCR (Recommended)**

   ```bash
   docker pull ghcr.io/alice39s/kuma-mieru:1
   ```

2. **Modify Environment Variables**

   ```bash
   cp .env.example .env
   ```

   Please refer to the [Environment Variables](#environment-variables) section for more details.

3. **Run Container**

   ```bash
   docker run -d \
     --name kuma-mieru \
     -p 3883:3000 \
     -e UPTIME_KUMA_BASE_URL=https://example.kuma-mieru.invalid \
     -e PAGE_ID=your-status-page-id \
     ghcr.io/alice39s/kuma-mieru:1
   ```

### Environment Variables

First, assume your Uptime Kuma status page URL is `https://example.kuma-mieru.invalid/status/test1`

Then, the environment variables you need to configure are as follows:

| Variable Name            | Required | Description                                                                                                     | Example                                                                                   |
| ------------------------ | -------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| UPTIME_KUMA_BASE_URL     | Yes      | Base URL of Uptime Kuma instance                                                                                | <https://example.kuma-mieru.invalid>                                                      |
| PAGE_ID                  | Yes      | Status page path of Uptime Kuma. Supports comma-separated multiple IDs with the first value as the default page | default,status-asia                                                                       |
| FEATURE_EDIT_THIS_PAGE   | No       | Whether to show "Edit This Page" button                                                                         | false                                                                                     |
| FEATURE_SHOW_STAR_BUTTON | No       | Whether to show "Star on Github" button                                                                         | true                                                                                      |
| FEATURE_TITLE            | No       | Custom page title                                                                                               | My Monitoring Dashboard                                                                   |
| FEATURE_DESCRIPTION      | No       | Custom page description                                                                                         | A beautiful monitoring dashboard                                                          |
| FEATURE_ICON             | No       | Custom page icon URL                                                                                            | /icon.svg                                                                                 |
| ALLOW_INSECURE_TLS       | No       | Whether to skip HTTPS certificate validation when requesting upstream Uptime Kuma (trusted self-signed only)    | `false` (default, strict validation) / `true` (skip validation, security risk)            |
| ALLOW_EMBEDDING          | No       | Whether to allow embedding in iframe                                                                            | `false` (block) / `true` (allow all, not recommended) / `example.com,app.com` (whitelist) |

### Health Check

The Docker container includes a built-in health check mechanism that verifies service status every 30 seconds. The health check API endpoint is `/api/health`, returning:

```json
{
  "status": "ok",
  "timestamp": "2024-03-20T12:34:56.789Z",
  "uptime": 123.456
}
```

Check container health status using:

```bash
docker ps
```

Or via Docker Compose:

```bash
docker compose ps
```

Directly access the health check API:

```bash
curl http://localhost:3883/api/health
```

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
