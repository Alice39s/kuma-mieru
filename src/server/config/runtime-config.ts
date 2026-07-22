import { readFile } from 'node:fs/promises';
import type Database from 'better-sqlite3';
import { parse as parseYaml } from 'yaml';
import {
  canonicalConfigSchema,
  configModeSchema,
  type CanonicalConfig,
  type ConfigMode,
} from './schema.js';
import { createManagedRevision, getActiveRevision, hashConfig } from './repository.js';

export interface RuntimeConfigSnapshot {
  mode: ConfigMode;
  revision: number | null;
  contentHash: string;
  loadedAt: string;
  config: CanonicalConfig;
}

export interface RuntimeConfigOptions {
  database: Database.Database;
  environment?: NodeJS.ProcessEnv;
  readConfigFile?: (path: string) => Promise<string>;
}

const legacyKeys = [
  'UPTIME_KUMA_URLS',
  'UPTIME_KUMA_BASE_URL',
  'PAGE_ID',
  'KUMA_MIERU_TITLE',
  'FEATURE_TITLE',
] as const;

const emptyConfig = (): CanonicalConfig => ({
  schemaVersion: 1,
  server: {},
  sources: [],
  pages: [],
});

export const detectConfigMode = (environment: NodeJS.ProcessEnv): ConfigMode => {
  const explicit = environment.KUMA_MIERU_CONFIG_MODE;
  if (explicit) {
    return configModeSchema.parse(explicit);
  }
  return legacyKeys.some(key => Boolean(environment[key])) ? 'compatibility' : 'managed';
};

const splitPageIds = (input: string | undefined) =>
  (input ?? 'default')
    .split(/[\s,]+/u)
    .map(value => value.trim())
    .filter(Boolean);

const parseStatusUrl = (input: string) => {
  const url = new URL(input);
  const marker = '/status/';
  const markerIndex = url.pathname.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error(`UPTIME_KUMA_URLS entry must contain ${marker}`);
  }
  const prefix = url.pathname.slice(0, markerIndex);
  const pageId = url.pathname.slice(markerIndex + marker.length).split('/')[0];
  if (!pageId) {
    throw new Error('UPTIME_KUMA_URLS entry is missing a page id');
  }
  return { baseUrl: `${url.origin}${prefix}`, pageId };
};

const loadCompatibilityConfig = (environment: NodeJS.ProcessEnv): CanonicalConfig => {
  const title = environment.KUMA_MIERU_TITLE ?? environment.FEATURE_TITLE ?? 'Kuma Mieru';
  const fullUrls = (environment.UPTIME_KUMA_URLS ?? '')
    .split('|')
    .map(value => value.trim())
    .filter(Boolean);

  const sources = fullUrls.length
    ? fullUrls.map((value, index) => {
        const parsed = parseStatusUrl(value);
        return {
          id: `legacy-${index + 1}`,
          kind: 'uptime-kuma' as const,
          baseUrl: parsed.baseUrl,
          pageIds: [parsed.pageId],
        };
      })
    : [
        {
          id: 'legacy-1',
          kind: 'uptime-kuma' as const,
          baseUrl: new URL(environment.UPTIME_KUMA_BASE_URL ?? 'http://127.0.0.1:3001')
            .toString()
            .replace(/\/$/u, ''),
          pageIds: splitPageIds(environment.PAGE_ID),
        },
      ];

  return canonicalConfigSchema.parse({
    schemaVersion: 1,
    server: {},
    sources,
    pages: sources.flatMap(source =>
      source.pageIds.map(pageId => ({
        id: `${source.id}-${pageId}`,
        slug: pageId,
        title,
        sourceRefs: [source.id],
      }))
    ),
  });
};

export const loadRuntimeConfig = async ({
  database,
  environment = process.env,
  readConfigFile = path => readFile(path, 'utf8'),
}: RuntimeConfigOptions): Promise<RuntimeConfigSnapshot> => {
  const mode = detectConfigMode(environment);
  const loadedAt = new Date().toISOString();

  if (mode === 'managed') {
    const revision =
      getActiveRevision(database) ??
      createManagedRevision(database, emptyConfig(), 'system:bootstrap');
    return {
      mode,
      revision: revision.revision,
      contentHash: revision.contentHash,
      loadedAt,
      config: revision.config,
    };
  }

  if (mode === 'file') {
    const path = environment.KUMA_MIERU_CONFIG;
    if (!path) {
      throw new Error('KUMA_MIERU_CONFIG is required in file mode');
    }
    const config = canonicalConfigSchema.parse(parseYaml(await readConfigFile(path)));
    return { mode, revision: null, contentHash: hashConfig(config), loadedAt, config };
  }

  const config = loadCompatibilityConfig(environment);
  return { mode, revision: null, contentHash: hashConfig(config), loadedAt, config };
};
