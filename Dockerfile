# ============================================
# Build stage
# ============================================
FROM node:20-alpine AS builder

RUN npm install -g bun@latest

WORKDIR /app

# 构建时固定的环境变量
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  UPTIME_KUMA_BASE_URL=https://whimsical-sopapillas-78abba.netlify.app \
  PAGE_ID=demo \
  FEATURE_EDIT_THIS_PAGE=false \
  FEATURE_SHOW_STAR_BUTTON=true \
  FEATURE_TITLE="Uptime Kuma" \
  FEATURE_DESCRIPTION="A beautiful and modern uptime monitoring dashboard" \
  FEATURE_ICON="" \
  ALLOW_EMBEDDING=false

# 复制依赖文件
COPY package.json bun.lock ./
COPY scripts ./scripts
COPY utils ./utils

# 使用 Bun 安装依赖
RUN set -e && \
    echo "Installing dependencies..." && \
    bun install --frozen-lockfile || { echo "Failed to install dependencies"; exit 1; }

# 复制源代码
COPY . .

# 使用 Node.js 构建应用
RUN set -e && \
    echo "Starting build process..." && \
    bun run generate && \
    npx next build || { echo "Build failed"; exit 1; }



# ============================================
# Runtime stage
# ============================================
FROM node:20-alpine
WORKDIR /app

# 安装 Bun 用于生成配置和运行初始化脚本
RUN npm install -g bun@latest

# 运行时的所有 ARG 和 ENV 配置
ARG PORT=3000
ARG HOSTNAME="0.0.0.0"
ARG NODE_ENV=production
ARG NEXT_TELEMETRY_DISABLED=1
ARG UPTIME_KUMA_BASE_URL=https://whimsical-sopapillas-78abba.netlify.app
ARG PAGE_ID=demo
ARG FEATURE_EDIT_THIS_PAGE=false
ARG FEATURE_SHOW_STAR_BUTTON=true
ARG FEATURE_TITLE="Uptime Kuma"
ARG FEATURE_DESCRIPTION="A beautiful and modern uptime monitoring dashboard"
ARG FEATURE_ICON=
ARG ALLOW_EMBEDDING=false
ARG IS_DOCKER=true

ENV PORT=${PORT} \
  HOSTNAME=${HOSTNAME} \
  NODE_ENV=${NODE_ENV} \
  NEXT_TELEMETRY_DISABLED=${NEXT_TELEMETRY_DISABLED} \
  UPTIME_KUMA_BASE_URL=${UPTIME_KUMA_BASE_URL} \
  PAGE_ID=${PAGE_ID} \
  FEATURE_EDIT_THIS_PAGE=${FEATURE_EDIT_THIS_PAGE} \
  FEATURE_SHOW_STAR_BUTTON=${FEATURE_SHOW_STAR_BUTTON} \
  FEATURE_TITLE=${FEATURE_TITLE} \
  FEATURE_DESCRIPTION=${FEATURE_DESCRIPTION} \
  FEATURE_ICON=${FEATURE_ICON} \
  ALLOW_EMBEDDING=${ALLOW_EMBEDDING} \
  IS_DOCKER=${IS_DOCKER}

# 安装运行时需要的工具（healthcheck 用）
RUN apk add --no-cache curl dumb-init && \
    addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001 && \
    chown -R nextjs:nodejs /app

# 切换到非 root 用户
USER nextjs

# 创建最小化的 package.json 只包含运行时依赖
# 包括 serverExternalPackages 声明的包：sharp, cheerio, markdown-it, sanitize-html
# 以及 generate 脚本需要的：zod, json5, dotenv, chalk
RUN bun add --no-cache --production sharp cheerio markdown-it sanitize-html zod json5 dotenv chalk

# 从 builder 复制构建产物（standalone 输出）
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone/ ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/config ./config
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/utils ./utils

EXPOSE ${PORT}

# Healthcheck 配置
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD curl -f http://localhost:${PORT}/api/health || exit 1

# 使用 dumb-init 作为 PID 1，正确处理信号
# 使用 Node.js 运行 standalone 服务器 (缓解 worker_threads napi 兼容性问题)
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["sh", "-c", "bun run generate && bun run scripts/docker-init.ts && exec node server.js"]
