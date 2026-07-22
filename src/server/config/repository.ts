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
