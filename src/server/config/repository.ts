import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  canonicalConfigSchema,
  configModeSchema,
  type CanonicalConfig,
  type ConfigMode,
} from './schema.js';

interface RevisionRow {
  revision: number;
  config_json: string;
  content_hash: string;
}

export interface ConfigRevision {
  revision: number;
  config: CanonicalConfig;
  contentHash: string;
}

export interface ConfigRevisionSummary {
  revision: number;
  contentHash: string;
  parentRevision: number | null;
  actor: string;
  createdAt: string;
}

export interface DurableConfigState {
  mode: ConfigMode | null;
  managedRevision: number | null;
  fileRevision: number | null;
  filePath: string | null;
  fileSourceHash: string | null;
  transitionId: string | null;
}

export const hashConfig = (config: CanonicalConfig) =>
  createHash('sha256').update(JSON.stringify(config), 'utf8').digest('hex');

const parseRevision = (row: RevisionRow): ConfigRevision => ({
  revision: row.revision,
  config: canonicalConfigSchema.parse(JSON.parse(row.config_json)),
  contentHash: row.content_hash,
});

const getRuntimeState = (database: Database.Database, key: string) =>
  (
    database.prepare('SELECT value FROM runtime_state WHERE key = ?').get(key) as
      | { value: string }
      | undefined
  )?.value ?? null;

export const setRuntimeState = (
  database: Database.Database,
  key: string,
  value: string | null,
  now = new Date().toISOString()
) => {
  if (value === null) {
    database.prepare('DELETE FROM runtime_state WHERE key = ?').run(key);
    return;
  }
  database
    .prepare(
      `INSERT INTO runtime_state (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, value, now);
};

const parseRevisionPointer = (value: string | null) => {
  if (value === null) return null;
  const revision = Number(value);
  return Number.isInteger(revision) && revision > 0 ? revision : null;
};

export const getDurableConfigState = (database: Database.Database): DurableConfigState => {
  const modeValue = getRuntimeState(database, 'active_config_mode');
  return {
    mode: modeValue ? configModeSchema.parse(modeValue) : null,
    managedRevision: parseRevisionPointer(getRuntimeState(database, 'active_config_revision')),
    fileRevision: parseRevisionPointer(getRuntimeState(database, 'active_file_revision')),
    filePath: getRuntimeState(database, 'active_file_path'),
    fileSourceHash: getRuntimeState(database, 'active_file_source_hash'),
    transitionId: getRuntimeState(database, 'active_config_transition_id'),
  };
};

export const setDurableConfigMode = (
  database: Database.Database,
  input: {
    mode: ConfigMode;
    managedRevision?: number | null;
    fileRevision?: number | null;
    filePath?: string | null;
    fileSourceHash?: string | null;
    transitionId?: string | null;
    now?: string;
  }
) => {
  const now = input.now ?? new Date().toISOString();
  setRuntimeState(database, 'active_config_mode', input.mode, now);
  if (input.managedRevision !== undefined) {
    setRuntimeState(
      database,
      'active_config_revision',
      input.managedRevision === null ? null : String(input.managedRevision),
      now
    );
  }
  if (input.fileRevision !== undefined) {
    setRuntimeState(
      database,
      'active_file_revision',
      input.fileRevision === null ? null : String(input.fileRevision),
      now
    );
  }
  if (input.filePath !== undefined) {
    setRuntimeState(database, 'active_file_path', input.filePath, now);
  }
  if (input.fileSourceHash !== undefined) {
    setRuntimeState(database, 'active_file_source_hash', input.fileSourceHash, now);
  }
  if (input.transitionId !== undefined) {
    setRuntimeState(database, 'active_config_transition_id', input.transitionId, now);
  }
};

export const getConfigRevision = (
  database: Database.Database,
  revision: number,
  mode: 'managed' | 'file'
): ConfigRevision | null => {
  const row = database
    .prepare(
      `SELECT revision, config_json, content_hash
       FROM config_revisions WHERE revision = ? AND mode = ?`
    )
    .get(revision, mode) as RevisionRow | undefined;
  return row ? parseRevision(row) : null;
};

export const findConfigRevisionByHash = (
  database: Database.Database,
  mode: 'managed' | 'file',
  contentHash: string
): ConfigRevision | null => {
  const row = database
    .prepare(
      `SELECT revision, config_json, content_hash
       FROM config_revisions WHERE mode = ? AND content_hash = ?`
    )
    .get(mode, contentHash) as RevisionRow | undefined;
  return row ? parseRevision(row) : null;
};

export const insertConfigRevision = (
  database: Database.Database,
  input: {
    mode: 'managed' | 'file';
    config: CanonicalConfig;
    parentRevision: number | null;
    actor: string;
    now?: string;
  }
): ConfigRevision => {
  const config = canonicalConfigSchema.parse(input.config);
  const contentHash = hashConfig(config);
  const result = database
    .prepare(
      `INSERT INTO config_revisions
        (mode, config_json, content_hash, parent_revision, actor, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.mode,
      JSON.stringify(config),
      contentHash,
      input.parentRevision,
      input.actor,
      input.now ?? new Date().toISOString()
    );
  return {
    revision: Number(result.lastInsertRowid),
    config,
    contentHash,
  };
};

export const getActiveRevision = (database: Database.Database): ConfigRevision | null => {
  const revision = getDurableConfigState(database).managedRevision;
  return revision ? getConfigRevision(database, revision, 'managed') : null;
};

export const createManagedRevision = (
  database: Database.Database,
  input: CanonicalConfig,
  actor: string
): ConfigRevision => {
  const config = canonicalConfigSchema.parse(input);
  const contentHash = hashConfig(config);
  const now = new Date().toISOString();

  const create = database.transaction(() => {
    const existing = database
      .prepare(
        `SELECT revision, config_json, content_hash
         FROM config_revisions
         WHERE mode = 'managed' AND content_hash = ?`
      )
      .get(contentHash) as RevisionRow | undefined;

    let revision = existing?.revision;
    if (!revision) {
      const active = getActiveRevision(database);
      const result = database
        .prepare(
          `INSERT INTO config_revisions
            (mode, config_json, content_hash, parent_revision, actor, created_at)
           VALUES ('managed', ?, ?, ?, ?, ?)`
        )
        .run(JSON.stringify(config), contentHash, active?.revision ?? null, actor, now);
      revision = Number(result.lastInsertRowid);
    }

    setRuntimeState(database, 'active_config_revision', String(revision), now);

    return revision;
  })();

  const row = database
    .prepare('SELECT revision, config_json, content_hash FROM config_revisions WHERE revision = ?')
    .get(create) as RevisionRow;
  return parseRevision(row);
};

export const getManagedRevision = (
  database: Database.Database,
  revision: number
): ConfigRevision | null => getConfigRevision(database, revision, 'managed');

export const listManagedRevisions = (
  database: Database.Database,
  limit = 50
): ConfigRevisionSummary[] =>
  (
    database
      .prepare(
        `SELECT revision, content_hash, parent_revision, actor, created_at
         FROM config_revisions
         WHERE mode = 'managed'
         ORDER BY revision DESC
         LIMIT ?`
      )
      .all(Math.min(Math.max(limit, 1), 100)) as Array<{
      revision: number;
      content_hash: string;
      parent_revision: number | null;
      actor: string;
      created_at: string;
    }>
  ).map(row => ({
    revision: row.revision,
    contentHash: row.content_hash,
    parentRevision: row.parent_revision,
    actor: row.actor,
    createdAt: row.created_at,
  }));

export const insertManagedRevision = (
  database: Database.Database,
  config: CanonicalConfig,
  parentRevision: number,
  actor: string
): ConfigRevision => {
  const parsed = canonicalConfigSchema.parse(config);
  const now = new Date().toISOString();
  const created = insertConfigRevision(database, {
    mode: 'managed',
    config: parsed,
    parentRevision,
    actor,
    now,
  });
  setRuntimeState(database, 'active_config_revision', String(created.revision), now);
  return created;
};
