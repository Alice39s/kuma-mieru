import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import type Database from 'better-sqlite3';
import { parse as parseYaml } from 'yaml';
import {
  canonicalConfigSchema,
  configModeSchema,
  type CanonicalConfig,
  type ConfigMode,
} from './schema.js';
import {
  createManagedRevision,
  findConfigRevisionByHash,
  getActiveRevision,
  getConfigRevision,
  getDurableConfigState,
  hashConfig,
  insertConfigRevision,
  setDurableConfigMode,
} from './repository.js';
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
  filePath?: string;
  fileSourceHash?: string;
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
  controlProviders: [],
});

export const hashConfigSource = (content: string) =>
  createHash('sha256').update(content, 'utf8').digest('hex');

export const maximumConfigFileBytes = 2 * 1_024 * 1_024;

export const readRegularConfigFile = async (path: string) => {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error('Configuration path must be a regular file');
    if (metadata.size > maximumConfigFileBytes) {
      throw new Error('Configuration file must not exceed 2 MiB');
    }
    const content = Buffer.allocUnsafe(maximumConfigFileBytes + 1);
    let offset = 0;
    while (offset < content.length) {
      const { bytesRead } = await handle.read(content, offset, content.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maximumConfigFileBytes) {
      throw new Error('Configuration file must not exceed 2 MiB');
    }
    return content.subarray(0, offset).toString('utf8');
  } finally {
    await handle.close();
  }
};

export const parseConfigFile = (content: string) => canonicalConfigSchema.parse(parseYaml(content));

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
  readConfigFile = readRegularConfigFile,
}: RuntimeConfigOptions): Promise<RuntimeConfigSnapshot> => {
  const durable = getDurableConfigState(database);
  const mode = durable.mode ?? detectConfigMode(environment);
  const loadedAt = new Date().toISOString();

  if (mode === 'managed') {
    const revision =
      getActiveRevision(database) ??
      createManagedRevision(database, emptyConfig(), 'system:bootstrap');
    if (durable.mode === null) {
      setDurableConfigMode(database, {
        mode,
        managedRevision: revision.revision,
        transitionId: null,
        now: loadedAt,
      });
    }
    return {
      mode,
      revision: revision.revision,
      contentHash: revision.contentHash,
      loadedAt,
      config: revision.config,
    };
  }

  if (mode === 'file') {
    const path = durable.filePath ?? environment.KUMA_MIERU_CONFIG;
    if (!path) {
      throw new Error('KUMA_MIERU_CONFIG is required in file mode');
    }
    const resolvedPath = resolve(path);
    if (durable.mode === 'file' && durable.fileRevision) {
      const revision = getConfigRevision(database, durable.fileRevision, 'file');
      if (!revision) throw new Error('Active file configuration revision is missing');
      return {
        mode,
        revision: null,
        contentHash: revision.contentHash,
        loadedAt,
        config: revision.config,
        filePath: resolvedPath,
        fileSourceHash: durable.fileSourceHash ?? undefined,
      };
    }

    const content = await readConfigFile(resolvedPath);
    const config = parseConfigFile(content);
    const contentHash = hashConfig(config);
    const fileRevision =
      findConfigRevisionByHash(database, 'file', contentHash) ??
      insertConfigRevision(database, {
        mode: 'file',
        config,
        parentRevision: null,
        actor: 'system:file-bootstrap',
        now: loadedAt,
      });
    const managedBase =
      getActiveRevision(database) ??
      createManagedRevision(database, config, 'system:file-bootstrap-base');
    setDurableConfigMode(database, {
      mode,
      managedRevision: managedBase.revision,
      fileRevision: fileRevision.revision,
      filePath: resolvedPath,
      fileSourceHash: hashConfigSource(content),
      transitionId: null,
      now: loadedAt,
    });
    return {
      mode,
      revision: null,
      contentHash,
      loadedAt,
      config,
      filePath: resolvedPath,
      fileSourceHash: hashConfigSource(content),
    };
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
