# Kuma Mieru :traffic_light:

Kuma Mieru 是一款基于 Next.js 16、TypeScript 和 Recharts 构建的第三方 Uptime Kuma 监控仪表盘。

本项目使用 Recharts 解决了 Uptime Kuma 内建公开状态页面不够直观、没有延迟图表等痛点。

中文版 | [English Version](README.en.md)

> [!WARNING]
> 新版 (v1.1.4+) 重构了时间处理逻辑，请注意修改 _Uptime Kuma_ 后台设置的 `Display Timezone` (显示时区) 为 `UTC+0` 时区。

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

## 目录

- [Kuma Mieru :traffic_light:](#kuma-mieru-traffic_light)
  - [目录](#目录)
  - [功能亮点 :sparkles:](#功能亮点-sparkles)
  - [测试截图 :camera:](#测试截图-camera)
  - [快速部署 :star:](#快速部署-star)
    - [使用 Vercel 部署 (推荐)](#使用-vercel-部署-推荐)
      - [1. Fork 仓库](#1-fork-仓库)
      - [2. 导入到 Vercel](#2-导入到-vercel)
      - [3. 配置环境变量](#3-配置环境变量)
      - [4. 更新仓库](#4-更新仓库)
    - [使用 Cloudflare Workers 部署](#使用-cloudflare-workers-部署)
    - [本地部署](#本地部署)
  - [Docker 部署 :whale: (Beta)](#docker-部署-whale-beta)
    - [使用 Docker Compose（推荐）](#使用-docker-compose推荐)
    - [Docker Run 部署](#docker-run-部署)
      - [1. 获取容器镜像](#1-获取容器镜像)
        - [从 GHCR 拉取镜像（推荐）](#从-ghcr-拉取镜像推荐)
      - [2. 修改环境变量](#2-修改环境变量)
      - [3. 启动容器服务](#3-启动容器服务)
        - [使用 GHCR 镜像启动](#使用-ghcr-镜像启动)
  - [版本策略](#版本策略)
  - [从 v1 升级到 v2 (2.0.0-alpha)](#从-v1-升级到-v2-200-alpha)
  - [环境变量配置](#环境变量配置)
  - [与 Uptime Kuma 集成 :link:](#与-uptime-kuma-集成-link)
  - [FAQ :question:](#faq-question)
    - [为什么我在 Kuma Mieru 中看到的时间与 Uptime Kuma 中有偏移？](#为什么我在-kuma-mieru-中看到的时间与-uptime-kuma-中有偏移)
    - [请问兼容 Uptime Robot / Better Stack / 其他监控数据源吗？](#请问兼容-uptime-robot--better-stack--其他监控数据源吗)
  - [贡献指南 :handshake:](#贡献指南-handshake)
  - [Star History :star2:](#star-history-star2)
  - [开源许可 :lock:](#开源许可-lock)

## 功能亮点 :sparkles:

- **实时监控，自动刷新** :arrows_clockwise:：状态显示**实时更新**，无需手动刷新，随时掌握最新动态。
- **美观响应式界面** :art:：采用 **HeroUI 组件** 构建，界面更加现代，**完美适配**各种设备屏幕。
- **交互式图表** :chart_with_upwards_trend:：利用 **Recharts** 图表库实现数据可视化，可以 **交互式** 地查看各节点的延迟、状态等数据。
- **多主题支持** :bulb:：提供 **暗色** / **亮色** / **系统** 多种主题，满足不同偏好。
- **维护公告**：支持 Uptime Kuma 的 **事件公告** 和 **状态更新** 特性，实时同步更高效。

## 测试截图 :camera:

| Dark Mode                               | Light Mode                                |
| --------------------------------------- | ----------------------------------------- |
| ![Dark Mode](./docs/v1.2.1-dark-zh.png) | ![Light Mode](./docs/v1.2.1-light-zh.png) |

## 快速部署 :star:

### 使用 Vercel 部署 (推荐)

#### 1. Fork 仓库

Fork 本仓库到您的 GitHub 用户下，如图所示：

1. 在这里 [Fork](https://github.com/Alice39s/kuma-mieru/fork) 本仓库
2. 点击 `Create fork` 按钮

> [!NOTE]
> 请确保您 Fork 的仓库是公开的，否则后续可能无法快速同步本仓库的更新。
>
> 请放心，您所有的配置均使用环境变量配置，Fork 的代码库 **不会泄漏** 您的任何配置信息。

#### 2. 导入到 Vercel

进入 <https://vercel.com/new> ，选择 Import 刚才 Fork 的仓库，如图所示：

![导入仓库](./docs/vercel-import.png)

#### 3. 配置环境变量

> [!NOTE]
> 推荐配置 `UPTIME_KUMA_URLS`，否则无法正常显示监控数据。
>
> 仍兼容 `UPTIME_KUMA_BASE_URL` + `PAGE_ID` 旧配置。详细说明请参考 [环境变量配置](#环境变量配置) 一节。

1. 点击 `Environment Variables` 添加 `UPTIME_KUMA_URLS`（推荐）环境变量，如图所示：

![部署到 Vercel](./docs/vercel-deploy.png)

1. 点击 `Deploy` 按钮即可一键部署到 Vercel

#### 4. 更新仓库

1. 进入你 Fork 的 GitHub 仓库，点击 `Sync fork` 按钮
2. 点击 `Update branch` 按钮，即可自动同步本仓库的最新代码

### 使用 Cloudflare Workers 部署

> [!WARNING]
> Cloudflare Workers 部署暂未支持，推荐使用 [Vercel 部署](#使用-vercel-部署-推荐) / Netlify 代替。
>
> References: [#88](https://github.com/Alice39s/kuma-mieru/issues/88#issuecomment-2919619066)

~~与 [Vercel 部署](#使用-vercel-部署-推荐) 类似，只需将仓库导入到 Cloudflare 即可。~~

~~特别注意：~~

~~1. `Build command` 请使用 `bun run deploy:cloudflare` 命令，否则无法正常部署。~~
~~2. 一定要配置环境变量，详请参考 [环境变量配置](#环境变量配置) 一节。~~

### 本地部署

只需简单几步，即可快速启动 Kuma Mieru：

1. **克隆仓库**

   ```bash
   git clone https://github.com/Alice39s/kuma-mieru.git
   cd kuma-mieru
   ```

2. **安装依赖**

   Kuma Mieru 使用 [Bun](https://bun.sh/) 作为包管理器，您需要先安装 Bun：

   ```bash
   # Linux/macOS
   curl -fsSL https://bun.sh/install | bash
   # Windows
   powershell -c "irm bun.sh/install.ps1 | iex"
   ```

   然后再安装依赖包：

   ```bash
   bun install
   ```

3. **配置环境变量**
   复制 `.env.example` 文件为 `.env`：

   ```bash
   cp .env.example .env
   ```

   `.env` 文件中 **必填** 的环境变量，可参考 [环境变量配置](#环境变量配置) 章节。

4. **启动开发服务器**

   ```bash
   bun run dev
   ```

5. **访问仪表盘**
   打开浏览器，访问 [http://localhost:3883](http://localhost:3883) 即可查看您的 Kuma Mieru 监控仪表盘。

6. **部署上线**

   ```bash
   bun run build
   bun run start
   ```

## Docker 部署 :whale: (Beta)

### 使用 Docker Compose（推荐）

1. **克隆仓库**

   ```bash
   git clone https://github.com/Alice39s/kuma-mieru.git
   cd kuma-mieru
   ```

2. **配置环境变量**
   复制 `.env.example` 文件并创建 `.env` 文件：

   ```bash
   cp .env.example .env
   ```

   参考 [环境变量配置](#环境变量配置) 章节，配置必要的环境变量。

3. **启动服务**

   ```bash
   docker compose up -d
   ```

   服务将在 `http://0.0.0.0:3883` 上运行。

4. **查看日志**

   ```bash
   docker compose logs -f
   ```

5. **更新镜像**

   ```bash
   docker compose pull
   docker compose up -d
   ```

### Docker Run 部署

#### 1. 获取容器镜像

##### 从 GHCR 拉取镜像（推荐）

```bash
docker pull ghcr.io/alice39s/kuma-mieru:1
```

#### 2. 修改环境变量

复制 `.env.example` 文件并创建 `.env` 文件：

```bash
cp .env.example .env
```

请参考 [环境变量配置](#环境变量配置) 章节，优先配置 `.env` 中的 `UPTIME_KUMA_URLS` 变量。

#### 3. 启动容器服务

##### 使用 GHCR 镜像启动

```bash
docker run -d \
  --name kuma-mieru \
  -p 3883:3000 \
  -e UPTIME_KUMA_URLS="https://example.kuma-mieru.invalid/status/default|https://example.kuma-mieru.invalid/status/secondary" \
  -e KUMA_MIERU_TITLE="Kuma Mieru" \
  ghcr.io/alice39s/kuma-mieru:1
```

## 版本策略

> [!WARNING]
> Docker 镜像推荐使用 `ghcr.io/alice39s/kuma-mieru:1`（主版本通道）。
>
> `v1` 主版本内将尽可能保持向前兼容；`v2` 将是包含重大 Breaking Changes 的版本。
>
> 不推荐固定到次版本/补丁版本（例如 `:1.6` 或 `:1.6.2`），除非您有明确的灰度与回滚策略。

## 从 v1 升级到 v2 (2.0.0-alpha)

v2 是一个包含多项 Breaking Changes 的大版本。当前发布的是 `2.0.0-alpha.1`，主要用于收集反馈，**不建议直接用于生产**。如果您选择升级，请按下方清单逐项核对。

### 必读：远程图片域名策略默认收紧

这是最容易影响现有部署的一项变更。

| 项目 | v1 (1.x) | v2 (2.0.0-alpha) |
| --- | --- | --- |
| 环境变量 | `STRICT_IMAGE_REMOTE_PATTERNS`（默认 `false` = 放开所有域名） | `ALLOW_ANY_IMAGE_REMOTE_PATTERNS`（默认 `false` = **仅允许 build 时生成的域名**） |
| SVG 图标 | `dangerouslyAllowSVG: true`（允许） | `dangerouslyAllowSVG: false`（**禁止**） |
| 图片代理重定向 | 跟随 | `maximumRedirects: 0`（**不跟随**） |

**如果您在 Docker 运行时动态切换 Uptime Kuma 域名**，升级后图片可能加载失败。两种解决方式：

1. （推荐）保持默认严格模式，在 build 时通过 `UPTIME_KUMA_URLS` 让 `generate-image-domains` 收集所有需要的域名。
2. （不推荐）设置 `ALLOW_ANY_IMAGE_REMOTE_PATTERNS=true` 回退到 v1 的放开行为。

### HeroUI 依赖回退（修复 #469）

dependabot 曾将 `@heroui/react` 误升级到 v3（与现有 v2 组件代码不兼容，导致构建失败 #469）。v2 已将其回退到 `^2.8.10`，并通过 dependabot 配置冻结 `@heroui/*` 的 major 升级。如果您 fork 后自行管理依赖，请注意不要让 `@heroui/react` 升到 v3，除非您已完成 HeroUI v3 迁移。

### 行为变更（可能影响监控/API 消费）

- **pageId 查询参数白名单**：`/api/config`、`/api/monitor`、`/api/manage-status-page` 现在会校验 `pageId` 是否在已配置列表中。传入未知的 pageId 将回退到默认页面，而不是原样转发。
- **API 错误响应不再透传内部错误**：`createApiResponse` 在 500 错误时返回固定的 `'Internal Server Error'` 字符串，不再回显原始错误消息（避免泄露内部信息）。如果您有外部脚本解析这个字段，会看到变化。
- **图标代理字节流硬限制**：`/api/icon` 现在通过 `maxResponseBytes`（2MB）在读取流时强制限制，而不再仅依赖可伪造/可能缺失的 `Content-Length` 头。超大图标会被中断。
- **构建脚本执行方式**：`scripts/banner.ts` 现在只在 `import.meta.main`（即作为脚本直接执行）时打印，被 import 时不再有副作用。
- **pageId 字符校验**：`UPTIME_KUMA_URLS` 中含 `/ ? # \` 的 pageId 现在会在 build 期直接报错，而不是被静默 trim。

### 内部改造（通常无感知，但影响 fork 二开）

- 引入了 zod schema 在数据边界做运行时校验（preload-data、uptime-kuma API 响应等）。
- 大量"巨型文件"拆分为更小、可测试的模块（`fetch.ts` → `custom-fetch-core` + `request-policy` 等）。
- 项目首次引入测试（node:test，约 20 个测试文件）。
- 多个服务端模块标记了 `import 'server-only'`，防止误打包到客户端。

### 如何回到 v1

如果 v2-alpha 出现问题，您可以暂时回到 v1 稳定版：

- Docker：使用 `ghcr.io/alice39s/kuma-mieru:1` 而非 `:2` 或 `:latest`。
- Vercel/自建：将仓库回退到 `1.7.3` tag。

## 环境变量配置

首先，假设您的 Uptime Kuma 状态页面 URL 为：

`https://example.kuma-mieru.invalid/status/test1`

推荐配置：

`UPTIME_KUMA_URLS=https://example.kuma-mieru.invalid/status/test1`

如果有多个状态页，可以使用 `|` 分隔完整 URL：

`UPTIME_KUMA_URLS=https://example.kuma-mieru.invalid/status/test1|https://example.kuma-mieru.invalid/status/test2`

环境变量说明如下（含向后兼容）：

| 变量名                          | 必填  | 说明                                                                            | 示例/默认值                                                                                              |
| ------------------------------- | ----- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| UPTIME_KUMA_URLS                | Yes\* | 推荐。完整状态页 URL，支持使用 `\|` 分隔多个 URL（可来自不同 Kuma 实例）        | <https://example.kuma-mieru.invalid/status/default\|https://example.kuma-mieru.invalid/status/secondary> |
| UPTIME_KUMA_BASE_URL            | Yes\* | 兼容旧版。Uptime Kuma 实例基础 URL（当未设置 `UPTIME_KUMA_URLS` 时启用）        | <https://example.kuma-mieru.invalid>                                                                     |
| PAGE_ID                         | Yes\* | 兼容旧版。状态页 ID，支持逗号分隔多个页面（当未设置 `UPTIME_KUMA_URLS` 时启用） | default,status-asia                                                                                      |
| KUMA_MIERU_EDIT_THIS_PAGE       | No    | 是否展示 "Edit This Page" 按钮（新变量名）                                      | false                                                                                                    |
| KUMA_MIERU_SHOW_STAR_BUTTON     | No    | 是否展示 "Star on Github" 按钮（新变量名）                                      | true                                                                                                     |
| KUMA_MIERU_TITLE                | No    | 自定义页面标题（新变量名）                                                      | Kuma Mieru                                                                                               |
| KUMA_MIERU_DESCRIPTION          | No    | 自定义页面描述（新变量名）                                                      | A beautiful and modern uptime monitoring dashboard                                                       |
| KUMA_MIERU_ICON                 | No    | 自定义页面图标 URL（新变量名）                                                  | /icon.svg                                                                                                |
| FEATURE_EDIT_THIS_PAGE          | No    | 兼容旧版，等价于 `KUMA_MIERU_EDIT_THIS_PAGE`                                    | false                                                                                                    |
| FEATURE_SHOW_STAR_BUTTON        | No    | 兼容旧版，等价于 `KUMA_MIERU_SHOW_STAR_BUTTON`                                  | true                                                                                                     |
| FEATURE_TITLE                   | No    | 兼容旧版，等价于 `KUMA_MIERU_TITLE`                                             | Kuma Mieru                                                                                               |
| FEATURE_DESCRIPTION             | No    | 兼容旧版，等价于 `KUMA_MIERU_DESCRIPTION`                                       | A beautiful and modern uptime monitoring dashboard                                                       |
| FEATURE_ICON                    | No    | 兼容旧版，等价于 `KUMA_MIERU_ICON`                                              | /icon.svg                                                                                                |
| ALLOW_INSECURE_TLS              | No    | 是否跳过上游 Uptime Kuma HTTPS 证书校验（仅用于受信任的自签名环境）             | `false`（默认，强校验） / `true`（跳过校验，有安全风险）                                                 |
| REQUEST_TIMEOUT_MS              | No    | 全局上游请求超时（毫秒，默认值 8000）                                           | `8000`                                                                                                   |
| REQUEST_RETRY_MAX               | No    | 全局上游请求最大重试次数（默认值 3）                                            | `3`                                                                                                      |
| REQUEST_RETRY_DELAY_MS          | No    | 全局上游请求重试基础间隔（毫秒，默认值 500）                                    | `500`                                                                                                    |
| SSR_STRICT_MODE                 | No    | 是否启用严格 SSR 失败模式（多页面全部失败时触发全局错误页）                     | `true` / `false` （默认）                                                                                |
| NEXT_PUBLIC_ERROR_PAGE_DEV_MODE | No    | 是否在错误页显示完整堆栈                                                        | `false`（默认） / `true`                                                                                 |
| ALLOW_EMBEDDING                 | No    | 是否允许在 iframe 中嵌入（运行时生效，重建镜像后无需重新 build）                | `false` (禁止) / `true` (允许所有，不推荐) / `example.com,app.com` (白名单)                              |
| ALLOW_ANY_IMAGE_REMOTE_PATTERNS | No    | 是否放开 `next/image` 远程图片域名限制（构建时生效，不推荐）                    | `false`（默认，仅允许 `generate-image-domains` 生成的域名） / `true`（放开所有远程图片域名）             |

\* `UPTIME_KUMA_URLS` 与 `UPTIME_KUMA_BASE_URL + PAGE_ID` 二选一即可。若同时配置，优先使用 `UPTIME_KUMA_URLS`。

修改 `.env` 后请执行 `docker compose up -d --force-recreate` 让容器重新注入环境变量。

> [!WARNING]
> 默认情况下，`next/image` 仅允许 `generate-image-domains` 在构建阶段生成的远程图片域名。
> 如果你需要兼容 Docker 运行时才确定的远程图片域名，可以设置 `ALLOW_ANY_IMAGE_REMOTE_PATTERNS=true` 放开限制；这会扩大可优化的远程图片范围，不建议在高安全要求环境使用。

## 与 Uptime Kuma 集成 :link:

> [!NOTE]
> 经测试，本项目兼容 Uptime Kuma 的最新稳定版本 (v1.23.0+)
>
> 如您使用的版本较低，请参考 [Uptime Kuma 官方文档](https://github.com/louislam/uptime-kuma/wiki/%F0%9F%86%99-How-to-Update) 尝试升级到最新稳定版 (v1.23.0+)，注意备份好数据。

Kuma Mieru 与备受好评的开源监控工具 [Uptime Kuma](https://github.com/louislam/uptime-kuma) 无缝集成，您只需要：

1. 安装并配置 Uptime Kuma
2. 在 Uptime Kuma 设置中修改 `Display Timezone` (显示时区) 为任意 `UTC+0` 时区
3. 在 Uptime Kuma 中创建 "状态页面"
4. 在 `.env` 文件中配置环境变量

## FAQ :question:

### 为什么我在 Kuma Mieru 中看到的时间与 Uptime Kuma 中有偏移？

由于 Uptime Kuma 后端传递到前端的时间 **没有携带时区信息**，为了方便开发，Kuma Mieru 会 **自动将时间转换为 UTC+0 时区** 并显示。

如果您发现时区偏移，请前往 Uptime Kuma 设置中修改 `Display Timezone` (显示时区) 为任意 `UTC+0` 时区。

### 请问兼容 Uptime Robot / Better Stack / 其他监控数据源吗？

Kuma Mieru 设计之初就是为了解决 Uptime Kuma 的不足，所以 v1 暂时不考虑支持其他监控数据源。

不过 v2 版本可能会考虑支持 Uptime Robot / Better Stack 等其他监控工具的 API 接口。

## 贡献指南 :handshake:

非常欢迎您为 Kuma Mieru 项目作出贡献！

如果您有任何想法或建议，请参阅 [CONTRIBUTING.md](CONTRIBUTING.md) 了解详细的贡献方式。

## Star History :star2:

<a href="https://github.com/Alice39s/kuma-mieru/stargazers" target="_blank" style="display: block" align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Alice39s/kuma-mieru&type=Timeline&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Alice39s/kuma-mieru&type=Timeline" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Alice39s/kuma-mieru&type=Timeline" />
  </picture>
</a>

## 开源许可 :lock:

本项目采用 [MPL-2.0](LICENSE) (Mozilla Public License Version 2.0) 开源许可证。
