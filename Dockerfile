FROM oven/bun:1.3.14-alpine AS bun-base

RUN apk add --no-cache python3 make g++

FROM bun-base AS dependencies

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS builder

ARG KUMA_MIERU_SOURCE_COMMIT=unverified
ARG KUMA_MIERU_SOURCE_COMMITTED_AT=1970-01-01T00:00:00Z
ARG KUMA_MIERU_SOURCE_VERIFIED=false
COPY . .
RUN KUMA_MIERU_SOURCE_COMMIT="${KUMA_MIERU_SOURCE_COMMIT}" \
    KUMA_MIERU_SOURCE_COMMITTED_AT="${KUMA_MIERU_SOURCE_COMMITTED_AT}" \
    KUMA_MIERU_SOURCE_VERIFIED="${KUMA_MIERU_SOURCE_VERIFIED}" \
    KUMA_MIERU_SOURCE_DIRTY=false \
    bun run build

FROM bun-base AS production-dependencies

WORKDIR /app
COPY runtime/v2/package.json runtime/v2/bun.lock ./
RUN bun install --frozen-lockfile --production

FROM node:24-alpine AS runtime

ARG KUMA_MIERU_BUILD_VERSION=2.0.0-dev
ARG KUMA_MIERU_SOURCE_COMMIT=unverified
ARG KUMA_MIERU_SOURCE_COMMITTED_AT=1970-01-01T00:00:00Z
LABEL org.opencontainers.image.title="Kuma Mieru" \
      org.opencontainers.image.description="Uptime-first status page and public communication control plane" \
      org.opencontainers.image.source="https://github.com/Alice39s/kuma-mieru" \
      org.opencontainers.image.licenses="MPL-2.0" \
      org.opencontainers.image.version="${KUMA_MIERU_BUILD_VERSION}" \
      org.opencontainers.image.revision="${KUMA_MIERU_SOURCE_COMMIT}" \
      org.opencontainers.image.created="${KUMA_MIERU_SOURCE_COMMITTED_AT}"

RUN apk add --no-cache dumb-init \
    && addgroup -S -g 10001 kuma-mieru \
    && adduser -S -D -H -u 10001 -G kuma-mieru kuma-mieru \
    && mkdir -p /app /data \
    && chown -R 10001:10001 /app /data

WORKDIR /app
COPY --from=production-dependencies --chown=10001:10001 /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=10001:10001 /app/package.json ./package.json
COPY --from=builder --chown=10001:10001 /app/dist/v2 ./dist/v2

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    KUMA_MIERU_DATA_DIR=/data \
    KUMA_MIERU_BUILD_VERSION=${KUMA_MIERU_BUILD_VERSION}

USER 10001:10001
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health/live" || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/v2/server/index.js"]
