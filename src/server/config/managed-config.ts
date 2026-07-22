import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { canonicalConfigSchema, type CanonicalConfig } from './schema.js';
import {
  getActiveRevision,
  getManagedRevision,
  insertManagedRevision,
  type ConfigRevision,
} from './repository.js';

export interface AuditContext {
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface ManagedMutationInput {
  expectedRevision: number;
  audit: AuditContext;
  action: string;
  targetType: string;
  targetId?: string;
  mutate: (current: CanonicalConfig) => CanonicalConfig;
}

const managedError = (code: string, message: string) => Object.assign(new Error(message), { code });

const summarizeConfig = (config: CanonicalConfig) => ({
  schemaVersion: config.schemaVersion,
  sourceIds: config.sources.map(source => source.id),
  pageIds: config.pages.map(page => page.id),
});

const writeAudit = (
  database: Database.Database,
  input: ManagedMutationInput,
  before: CanonicalConfig,
  after: CanonicalConfig,
  revision: number
) => {
  database
    .prepare(
      `INSERT INTO admin_audit
        (id, occurred_at, actor_id, action, target_type, target_id, request_id,
         ip_address, user_agent, result, before_json, after_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'success', ?, ?)`
    )
    .run(
      randomUUID(),
      new Date().toISOString(),
      input.audit.actorId,
      input.action,
      input.targetType,
      input.targetId ?? String(revision),
      input.audit.requestId,
      input.audit.ipAddress ?? null,
      input.audit.userAgent ?? null,
      JSON.stringify(summarizeConfig(before)),
      JSON.stringify({ ...summarizeConfig(after), revision })
    );
};

export const mutateManagedConfig = (
  database: Database.Database,
  input: ManagedMutationInput
): ConfigRevision => {
  const transaction = database.transaction(() => {
    const active = getActiveRevision(database);
    if (!active) throw managedError('managed_config_missing', 'No active managed revision exists');
    if (active.revision !== input.expectedRevision) {
      throw managedError(
        'config_revision_conflict',
        `Expected revision ${input.expectedRevision}, active revision is ${active.revision}`
      );
    }
    const nextConfig = canonicalConfigSchema.parse(input.mutate(structuredClone(active.config)));
    const next = insertManagedRevision(database, nextConfig, active.revision, input.audit.actorId);
    writeAudit(database, input, active.config, next.config, next.revision);
    return next;
  });
  return transaction();
};

export const rollbackManagedConfig = (
  database: Database.Database,
  input: Omit<ManagedMutationInput, 'mutate'> & { targetRevision: number }
) => {
  const target = getManagedRevision(database, input.targetRevision);
  if (!target) throw managedError('config_revision_not_found', 'Target revision does not exist');
  return mutateManagedConfig(database, {
    ...input,
    targetId: String(input.targetRevision),
    mutate: () => target.config,
  });
};
