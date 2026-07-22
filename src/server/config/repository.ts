import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { canonicalConfigSchema, type CanonicalConfig } from './schema.js';

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

export const hashConfig = (config: CanonicalConfig) =>
  createHash('sha256').update(JSON.stringify(config), 'utf8').digest('hex');

const parseRevision = (row: RevisionRow): ConfigRevision => ({
  revision: row.revision,
  config: canonicalConfigSchema.parse(JSON.parse(row.config_json)),
  contentHash: row.content_hash,
});

export const getActiveRevision = (database: Database.Database): ConfigRevision | null => {
  const state = database
    .prepare("SELECT value FROM runtime_state WHERE key = 'active_config_revision'")
    .get() as { value: string } | undefined;
  if (!state) {
    return null;
  }

  const row = database
    .prepare(
      `SELECT revision, config_json, content_hash
       FROM config_revisions
       WHERE revision = ? AND mode = 'managed'`
    )
    .get(Number(state.value)) as RevisionRow | undefined;
  return row ? parseRevision(row) : null;
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

    database
      .prepare(
        `INSERT INTO runtime_state (key, value, updated_at)
         VALUES ('active_config_revision', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(String(revision), now);

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
): ConfigRevision | null => {
  const row = database
    .prepare(
      `SELECT revision, config_json, content_hash
       FROM config_revisions WHERE revision = ? AND mode = 'managed'`
    )
    .get(revision) as RevisionRow | undefined;
  return row ? parseRevision(row) : null;
};

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
  const contentHash = hashConfig(parsed);
  const now = new Date().toISOString();
  const result = database
    .prepare(
      `INSERT INTO config_revisions
        (mode, config_json, content_hash, parent_revision, actor, created_at)
       VALUES ('managed', ?, ?, ?, ?, ?)`
    )
    .run(JSON.stringify(parsed), contentHash, parentRevision, actor, now);
  const revision = Number(result.lastInsertRowid);
  database
    .prepare(
      `INSERT INTO runtime_state (key, value, updated_at)
       VALUES ('active_config_revision', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(String(revision), now);
  return { revision, config: parsed, contentHash };
};
