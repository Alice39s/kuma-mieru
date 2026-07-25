import { chmodSync, lstatSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';

export type SubscriberTerminalState = 'unsubscribed' | 'suppressed';

export interface SubscriberTombstone {
  pageId: string;
  scopeKey: string;
  emailHash: string;
  state: SubscriberTerminalState;
  recordedAt: string;
}

export interface SubscriberTombstoneStore {
  record(tombstone: SubscriberTombstone): void;
  apply(database: Database.Database): number;
  close(): void;
}

const assertPrivateDirectory = (path: string) => {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw Object.assign(new Error('Retention directory must be a real directory'), {
      code: 'retention_directory_unsafe',
    });
  }
  chmodSync(path, 0o700);
};

export const createSubscriberTombstoneStore = (dataDirectory: string): SubscriberTombstoneStore => {
  const directory = resolve(dataDirectory, '.retention');
  const databasePath = resolve(directory, 'subscriber-tombstones.sqlite3');
  assertPrivateDirectory(directory);
  const existing = (() => {
    try {
      return lstatSync(databasePath);
    } catch {
      return null;
    }
  })();
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) {
    throw Object.assign(new Error('Subscriber tombstone store must be a regular file'), {
      code: 'retention_tombstone_store_unsafe',
    });
  }

  const tombstoneDatabase = new Database(databasePath);
  chmodSync(databasePath, 0o600);
  tombstoneDatabase.pragma('journal_mode = DELETE');
  tombstoneDatabase.pragma('synchronous = FULL');
  tombstoneDatabase.exec(`
    CREATE TABLE IF NOT EXISTS subscriber_tombstones (
      page_id TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      email_hash TEXT NOT NULL,
      terminal_state TEXT NOT NULL
        CHECK (terminal_state IN ('unsubscribed', 'suppressed')),
      recorded_at TEXT NOT NULL,
      PRIMARY KEY (page_id, scope_key, email_hash)
    )
  `);

  const recordStatement = tombstoneDatabase.prepare(`
    INSERT INTO subscriber_tombstones
      (page_id, scope_key, email_hash, terminal_state, recorded_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(page_id, scope_key, email_hash) DO UPDATE SET
      terminal_state = excluded.terminal_state,
      recorded_at = excluded.recorded_at
    WHERE excluded.recorded_at > subscriber_tombstones.recorded_at
  `);

  const record = (tombstone: SubscriberTombstone) => {
    recordStatement.run(
      tombstone.pageId,
      tombstone.scopeKey,
      tombstone.emailHash,
      tombstone.state,
      tombstone.recordedAt
    );
  };

  const apply = (database: Database.Database) =>
    database.transaction(() => {
      const tombstones = tombstoneDatabase
        .prepare(
          `SELECT page_id, scope_key, email_hash, terminal_state, recorded_at
           FROM subscriber_tombstones ORDER BY recorded_at`
        )
        .all() as Array<{
        page_id: string;
        scope_key: string;
        email_hash: string;
        terminal_state: SubscriberTerminalState;
        recorded_at: string;
      }>;
      let applied = 0;
      const subscriptions = database.prepare(
        `SELECT id FROM email_subscriptions
         WHERE page_id = ? AND scope_key = ? AND email_hash = ?
           AND updated_at <= ? AND state NOT IN ('unsubscribed', 'suppressed', 'expired')`
      );
      const redactSubscription = database.prepare(
        `UPDATE email_subscriptions
         SET state = ?, email_ciphertext = '', pii_deleted_at = ?,
             updated_at = MAX(updated_at, ?)
         WHERE id = ?`
      );
      const stopDeliveries = database.prepare(
        `UPDATE notification_outbox
         SET state = CASE
               WHEN state IN ('queued', 'failed') THEN 'dead_letter'
               ELSE state
             END,
             payload_ciphertext = NULL,
             locked_at = CASE WHEN state = 'processing' THEN locked_at ELSE NULL END,
             locked_by = CASE WHEN state = 'processing' THEN locked_by ELSE NULL END,
             last_error_code = CASE
               WHEN state IN ('queued', 'failed') THEN 'SUBSCRIPTION_TOMBSTONED'
               ELSE last_error_code
             END
         WHERE subscription_id = ? AND state != 'processing'`
      );
      const deleteTokens = database.prepare(
        'DELETE FROM subscription_tokens WHERE subscription_id = ?'
      );
      for (const tombstone of tombstones) {
        const rows = subscriptions.all(
          tombstone.page_id,
          tombstone.scope_key,
          tombstone.email_hash,
          tombstone.recorded_at
        ) as Array<{ id: string }>;
        for (const row of rows) {
          redactSubscription.run(
            tombstone.terminal_state,
            tombstone.recorded_at,
            tombstone.recorded_at,
            row.id
          );
          stopDeliveries.run(row.id);
          deleteTokens.run(row.id);
          applied += 1;
        }
      }
      return applied;
    })();

  return {
    record,
    apply,
    close: () => tombstoneDatabase.close(),
  };
};
