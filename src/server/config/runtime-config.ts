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
import {
  buildLegacyMigrationPlan,
  legacyEnvironmentKeys,
  type LegacyMigrationPlan,
} from './legacy-compatibility.js';

export interface RuntimeConfigSnapshot {
  mode: ConfigMode;
  revision: number | null;
  contentHash: string;
  loadedAt: string;
  config: CanonicalConfig;
  compatibility?: Omit<LegacyMigrationPlan, 'config'>;
}

export interface RuntimeConfigOptions {
  database: Database.Database;
  environment?: NodeJS.ProcessEnv;
  readConfigFile?: (path: string) => Promise<string>;
}

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
  return legacyEnvironmentKeys.some(key => environment[key] !== undefined)
    ? 'compatibility'
    : 'managed';
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

  const plan = buildLegacyMigrationPlan({ environment });
  return {
    mode,
    revision: null,
    contentHash: plan.contentHash,
    loadedAt,
    config: plan.config,
    compatibility: {
      source: plan.source,
      contentHash: plan.contentHash,
      decisions: plan.decisions,
      conflicts: plan.conflicts,
      ignoredFields: plan.ignoredFields,
    },
  };
};
