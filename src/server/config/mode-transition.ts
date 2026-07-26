import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import type { BackupService } from '../db/backup.js';
import type { AuditContext } from './managed-config.js';
import {
  findConfigRevisionByHash,
  getDurableConfigState,
  getManagedRevision,
  hashConfig,
  insertConfigRevision,
  setDurableConfigMode,
  type DurableConfigState,
} from './repository.js';
import { canonicalConfigSchema, type CanonicalConfig } from './schema.js';
import {
  hashConfigSource,
  parseConfigFile,
  readRegularConfigFile,
  type RuntimeConfigSnapshot,
} from './runtime-config.js';

const sha256Schema = z
  .string()
  .length(64)
  .refine(value => [...value].every(character => '0123456789abcdef'.includes(character)), {
    message: 'Expected a lowercase SHA-256 digest',
  });

const managedTransitionSourceSchema = z
  .object({
    kind: z.literal('managed'),
    revision: z.number().int().positive(),
  })
  .strict();

const fileTransitionSourceSchema = z
  .object({
    kind: z.literal('file'),
    path: z.string().min(1).max(4_096),
    sha256: sha256Schema,
  })
  .strict();

const transitionSourceSchema = z.discriminatedUnion('kind', [
  managedTransitionSourceSchema,
  fileTransitionSourceSchema,
]);

const transitionRequestBaseSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    from: z.enum(['managed', 'file']),
    to: z.enum(['managed', 'file']),
    expectedActiveRevision: z.number().int().nonnegative(),
    source: transitionSourceSchema,
  })
  .strict();

export const configModeTransitionPreviewSchema = transitionRequestBaseSchema
  .extend({
    dryRun: z.literal(true),
  })
  .strict();

export const configModeTransitionApplySchema = transitionRequestBaseSchema
  .extend({
    dryRun: z.literal(false),
    previewToken: z.string().min(32).max(512),
  })
  .strict();

export type ConfigModeTransitionPreviewInput = z.infer<typeof configModeTransitionPreviewSchema>;
export type ConfigModeTransitionApplyInput = z.infer<typeof configModeTransitionApplySchema>;

export interface ConfigModeTransitionDiff {
  sources: { added: string[]; removed: string[]; changed: string[] };
  pages: { added: string[]; removed: string[]; changed: string[] };
  settings: { added: string[]; removed: string[]; changed: string[] };
}

export interface ConfigModeTransitionPreview {
  previewToken: string;
  expiresAt: string;
  from: 'managed' | 'file';
  to: 'managed' | 'file';
  expectedActiveRevision: number;
  sourceHash: string;
  targetContentHash: string;
  targetParentRevision: number | null;
  diff: ConfigModeTransitionDiff;
  conflicts: string[];
  unmigratableFields: string[];
}

export interface ConfigModeTransitionResult {
  transitionId: string;
  state: 'completed';
  mode: 'managed' | 'file';
  revision: number | null;
  contentHash: string;
  backupArtifactId: string;
  recovered: boolean;
}

export interface ConfigModeTransitionStatus {
  id: string;
  from: string;
  to: string;
  state: 'pending' | 'completed' | 'failed';
  sourceHash: string;
  targetHash: string | null;
  targetRevision: number | null;
  backupArtifactId: string | null;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface PreviewRow {
  id: string;
  token_hash: string;
  from_mode: 'managed' | 'file';
  to_mode: 'managed' | 'file';
  expected_revision: number;
  source_kind: 'managed' | 'file';
  source_ref: string;
  source_hash: string;
  target_content_hash: string;
  target_config_json: string;
  target_parent_revision: number | null;
  actor: string;
  expires_at: string;
  consumed_at: string | null;
}

interface TransitionRow {
  id: string;
  from_mode: string;
  to_mode: string;
  state: 'pending' | 'completed' | 'failed';
  source_hash: string;
  target_hash: string | null;
  target_revision: number | null;
  backup_artifact_id: string | null;
  error_code: string | null;
  created_at: string;
  completed_at: string | null;
}

interface CreateConfigModeTransitionServiceOptions {
  database: Database.Database;
  backupService: BackupService;
  allowedFilePath?: string;
  currentSnapshot: () => RuntimeConfigSnapshot;
  validateConfig?: (config: CanonicalConfig) => Promise<void>;
  applySnapshot: (snapshot: RuntimeConfigSnapshot) => void | Promise<void>;
  quiesceRuntime?: () => void | Promise<void>;
  resumeRuntime?: () => void | Promise<void>;
  now?: () => Date;
  previewTtlMs?: number;
  readConfigFile?: (path: string) => Promise<string>;
}

const transitionError = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

export const configModeTransitionErrorCode = (error: unknown) =>
  typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'config_transition_failed';

const tokenHash = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

const summarizeConfig = (config: CanonicalConfig) => ({
  schemaVersion: config.schemaVersion,
  sourceIds: config.sources.map(source => source.id),
  pageIds: config.pages.map(page => page.id),
  retentionPolicy: config.dataLifecycle?.retention ?? null,
});

const changedIds = <T extends { id: string }>(before: T[], after: T[]) => {
  const beforeById = new Map(before.map(item => [item.id, item]));
  const afterById = new Map(after.map(item => [item.id, item]));
  return {
    added: [...afterById.keys()].filter(id => !beforeById.has(id)).sort(),
    removed: [...beforeById.keys()].filter(id => !afterById.has(id)).sort(),
    changed: [...afterById.keys()]
      .filter(
        id =>
          beforeById.has(id) &&
          JSON.stringify(beforeById.get(id)) !== JSON.stringify(afterById.get(id))
      )
      .sort(),
  };
};

const settingKeys = ['server', 'delivery', 'events', 'dataLifecycle'] as const;

const settingsDiff = (
  before: CanonicalConfig,
  after: CanonicalConfig
): ConfigModeTransitionDiff['settings'] => {
  return settingKeys.reduce<ConfigModeTransitionDiff['settings']>(
    (diff, key) => {
      const beforeValue = before[key];
      const afterValue = after[key];
      if (beforeValue === undefined && afterValue !== undefined) diff.added.push(key);
      else if (beforeValue !== undefined && afterValue === undefined) diff.removed.push(key);
      else if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) diff.changed.push(key);
      return diff;
    },
    { added: [], removed: [], changed: [] }
  );
};

const configDiff = (before: CanonicalConfig, after: CanonicalConfig): ConfigModeTransitionDiff => ({
  sources: changedIds(before.sources, after.sources),
  pages: changedIds(before.pages, after.pages),
  settings: settingsDiff(before, after),
});

const expectedRevisionFor = (snapshot: RuntimeConfigSnapshot) =>
  snapshot.mode === 'managed' ? (snapshot.revision ?? 0) : 0;

const assertCurrentRequest = (
  snapshot: RuntimeConfigSnapshot,
  input: ConfigModeTransitionPreviewInput | ConfigModeTransitionApplyInput
) => {
  if (snapshot.mode !== input.from) {
    throw transitionError(
      'config_transition_mode_conflict',
      `Expected ${input.from} mode, active mode is ${snapshot.mode}`
    );
  }
  if (input.from === input.to) {
    throw transitionError(
      'config_transition_same_mode',
      'Same-mode operations must use rollback or reload'
    );
  }
  if (input.source.kind !== input.to) {
    throw transitionError(
      'config_transition_source_mismatch',
      'Transition source kind must match the target mode'
    );
  }
  const activeRevision = expectedRevisionFor(snapshot);
  if (activeRevision !== input.expectedActiveRevision) {
    throw transitionError(
      'config_revision_conflict',
      `Expected revision ${input.expectedActiveRevision}, active revision is ${activeRevision}`
    );
  }
};

const transitionStatus = (row: TransitionRow): ConfigModeTransitionStatus => ({
  id: row.id,
  from: row.from_mode,
  to: row.to_mode,
  state: row.state,
  sourceHash: row.source_hash,
  targetHash: row.target_hash,
  targetRevision: row.target_revision,
  backupArtifactId: row.backup_artifact_id,
  errorCode: row.error_code,
  createdAt: row.created_at,
  completedAt: row.completed_at,
});

const restoreDurableState = (
  database: Database.Database,
  state: DurableConfigState,
  now: string
) => {
  if (!state.mode) {
    throw transitionError(
      'config_transition_restore_missing',
      'Previous durable configuration mode is missing'
    );
  }
  setDurableConfigMode(database, {
    mode: state.mode,
    managedRevision: state.managedRevision,
    fileRevision: state.fileRevision,
    filePath: state.filePath,
    fileSourceHash: state.fileSourceHash,
    transitionId: state.transitionId,
    now,
  });
};

export const createConfigModeTransitionService = ({
  database,
  backupService,
  allowedFilePath,
  currentSnapshot,
  validateConfig = async () => undefined,
  applySnapshot,
  quiesceRuntime = async () => undefined,
  resumeRuntime = async () => undefined,
  now = () => new Date(),
  previewTtlMs = 10 * 60 * 1_000,
  readConfigFile = readRegularConfigFile,
}: CreateConfigModeTransitionServiceOptions) => {
  const configuredFilePath = allowedFilePath ? resolve(allowedFilePath) : null;
  let inFlight: Promise<ConfigModeTransitionResult> | null = null;

  const cleanupExpiredPreviews = () =>
    database
      .prepare(
        `DELETE FROM config_transition_previews
         WHERE consumed_at IS NULL AND expires_at < ?`
      )
      .run(now().toISOString()).changes;

  const inspectFileSource = async () => {
    if (!configuredFilePath) {
      throw transitionError(
        'config_file_path_not_configured',
        'No bootstrap file path is configured'
      );
    }
    const metadata = await lstat(configuredFilePath).catch(() => null);
    if (!metadata || !metadata.isFile() || metadata.isSymbolicLink()) {
      throw transitionError(
        'config_file_path_unsafe',
        'Configured file path must be a regular non-symlink file'
      );
    }
    const content = await readConfigFile(configuredFilePath);
    return {
      path: configuredFilePath,
      sha256: hashConfigSource(content),
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      content,
    };
  };

  const readFileCandidate = async (path: string, expectedHash: string) => {
    if (!configuredFilePath || resolve(path) !== configuredFilePath) {
      throw transitionError(
        'config_file_path_not_allowed',
        'File path is not the configured bootstrap path'
      );
    }
    const inspected = await inspectFileSource();
    const sourceHash = inspected.sha256;
    if (sourceHash !== expectedHash) {
      throw transitionError(
        'config_source_hash_drift',
        'Configuration file changed after its hash was selected'
      );
    }
    const config = parseConfigFile(inspected.content);
    return { config, sourceHash, path: configuredFilePath };
  };

  const resolveCandidate = async (
    input: ConfigModeTransitionPreviewInput | ConfigModeTransitionApplyInput
  ) => {
    const snapshot = currentSnapshot();
    assertCurrentRequest(snapshot, input);
    if (input.source.kind === 'file') {
      const candidate = await readFileCandidate(input.source.path, input.source.sha256);
      await validateConfig(candidate.config);
      return {
        config: candidate.config,
        sourceHash: candidate.sourceHash,
        sourceRef: candidate.path,
        targetParentRevision: null,
      };
    }

    const durable = getDurableConfigState(database);
    if (
      !durable.managedRevision ||
      durable.managedRevision !== input.source.revision ||
      !getManagedRevision(database, input.source.revision)
    ) {
      throw transitionError(
        'config_managed_base_conflict',
        'Managed import base revision is no longer active'
      );
    }
    await validateConfig(snapshot.config);
    return {
      config: canonicalConfigSchema.parse(structuredClone(snapshot.config)),
      sourceHash: snapshot.contentHash,
      sourceRef: String(input.source.revision),
      targetParentRevision: input.source.revision,
    };
  };

  const writeAudit = (
    audit: AuditContext,
    input: {
      action: 'config.mode.preview' | 'config.mode.apply';
      targetId: string;
      result: 'success' | 'failed';
      errorCode?: string;
      before: RuntimeConfigSnapshot;
      after: CanonicalConfig;
      details: Record<string, unknown>;
    }
  ) => {
    database
      .prepare(
        `INSERT INTO admin_audit
          (id, occurred_at, actor_id, action, target_type, target_id, request_id,
           ip_address, user_agent, result, error_code, before_json, after_json)
         VALUES (?, ?, ?, ?, 'config_transition', ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        now().toISOString(),
        audit.actorId,
        input.action,
        input.targetId,
        audit.requestId,
        audit.ipAddress ?? null,
        audit.userAgent ?? null,
        input.result,
        input.errorCode ?? null,
        JSON.stringify(summarizeConfig(input.before.config)),
        JSON.stringify({ ...summarizeConfig(input.after), ...input.details })
      );
  };

  const preview = async (
    rawInput: ConfigModeTransitionPreviewInput,
    audit: AuditContext
  ): Promise<ConfigModeTransitionPreview> => {
    const input = configModeTransitionPreviewSchema.parse(rawInput);
    const before = currentSnapshot();
    const candidate = await resolveCandidate(input);
    const targetContentHash = hashConfig(candidate.config);
    const token = randomBytes(32).toString('base64url');
    const id = randomUUID();
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + previewTtlMs);
    database.transaction(() => {
      cleanupExpiredPreviews();
      database
        .prepare(
          `INSERT INTO config_transition_previews
            (id, token_hash, from_mode, to_mode, expected_revision, source_kind, source_ref,
             source_hash, target_content_hash, target_config_json, target_parent_revision,
             actor, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          tokenHash(token),
          input.from,
          input.to,
          input.expectedActiveRevision,
          input.source.kind,
          candidate.sourceRef,
          candidate.sourceHash,
          targetContentHash,
          JSON.stringify(candidate.config),
          candidate.targetParentRevision,
          audit.actorId,
          createdAt.toISOString(),
          expiresAt.toISOString()
        );
      writeAudit(audit, {
        action: 'config.mode.preview',
        targetId: id,
        result: 'success',
        before,
        after: candidate.config,
        details: {
          from: input.from,
          to: input.to,
          sourceHash: candidate.sourceHash,
          targetContentHash,
          previewTokenHash: tokenHash(token),
        },
      });
    })();
    return {
      previewToken: token,
      expiresAt: expiresAt.toISOString(),
      from: input.from,
      to: input.to,
      expectedActiveRevision: input.expectedActiveRevision,
      sourceHash: candidate.sourceHash,
      targetContentHash,
      targetParentRevision: candidate.targetParentRevision,
      diff: configDiff(before.config, candidate.config),
      conflicts: [],
      unmigratableFields: [],
    };
  };

  const apply = (
    rawInput: ConfigModeTransitionApplyInput,
    audit: AuditContext
  ): Promise<ConfigModeTransitionResult> => {
    if (inFlight) {
      throw transitionError(
        'config_transition_in_progress',
        'Another configuration transition is in progress'
      );
    }
    const run = async (): Promise<ConfigModeTransitionResult> => {
      const input = configModeTransitionApplySchema.parse(rawInput);
      const before = currentSnapshot();
      assertCurrentRequest(before, input);
      const digest = tokenHash(input.previewToken);
      const previewRow = database
        .prepare(
          `SELECT id, token_hash, from_mode, to_mode, expected_revision, source_kind, source_ref,
                  source_hash, target_content_hash, target_config_json, target_parent_revision,
                  actor, expires_at, consumed_at
           FROM config_transition_previews WHERE token_hash = ?`
        )
        .get(digest) as PreviewRow | undefined;
      if (!previewRow) {
        throw transitionError('config_preview_token_invalid', 'Preview token is invalid');
      }
      if (previewRow.consumed_at) {
        throw transitionError('config_preview_token_consumed', 'Preview token was already applied');
      }
      if (Date.parse(previewRow.expires_at) <= now().getTime()) {
        throw transitionError('config_preview_token_expired', 'Preview token has expired');
      }
      if (previewRow.actor !== audit.actorId) {
        throw transitionError('config_preview_actor_mismatch', 'Preview token is invalid');
      }
      const sourceRef =
        input.source.kind === 'file' ? resolve(input.source.path) : String(input.source.revision);
      if (
        previewRow.from_mode !== input.from ||
        previewRow.to_mode !== input.to ||
        previewRow.expected_revision !== input.expectedActiveRevision ||
        previewRow.source_kind !== input.source.kind ||
        previewRow.source_ref !== sourceRef
      ) {
        throw transitionError(
          'config_preview_request_mismatch',
          'Apply request does not match the preview'
        );
      }
      const candidate = await resolveCandidate(input);
      const targetConfig = canonicalConfigSchema.parse(JSON.parse(previewRow.target_config_json));
      const targetContentHash = hashConfig(candidate.config);
      if (
        candidate.sourceHash !== previewRow.source_hash ||
        targetContentHash !== previewRow.target_content_hash ||
        JSON.stringify(candidate.config) !== JSON.stringify(targetConfig)
      ) {
        throw transitionError('config_source_hash_drift', 'Configuration changed after preview');
      }

      const backup = await backupService.create(audit.actorId);
      let activated = false;
      let runtimeRecovered = false;
      try {
        await quiesceRuntime();
        const refreshed = await resolveCandidate(input);
        if (
          refreshed.sourceHash !== previewRow.source_hash ||
          JSON.stringify(refreshed.config) !== JSON.stringify(targetConfig)
        ) {
          throw transitionError(
            'config_source_hash_drift',
            'Configuration changed while the transition backup was created'
          );
        }

        const previousDurable = getDurableConfigState(database);
        const transitionId = randomUUID();
        const appliedAt = now().toISOString();
        let targetRevision: number | null = null;
        const targetSnapshot = database.transaction(() => {
          assertCurrentRequest(currentSnapshot(), input);
          if (input.to === 'managed') {
            const revision = insertConfigRevision(database, {
              mode: 'managed',
              config: targetConfig,
              parentRevision: previewRow.target_parent_revision,
              actor: audit.actorId,
              now: appliedAt,
            });
            targetRevision = revision.revision;
            setDurableConfigMode(database, {
              mode: 'managed',
              managedRevision: revision.revision,
              transitionId,
              now: appliedAt,
            });
          } else {
            const revision =
              findConfigRevisionByHash(database, 'file', previewRow.target_content_hash) ??
              insertConfigRevision(database, {
                mode: 'file',
                config: targetConfig,
                parentRevision: previousDurable.fileRevision,
                actor: audit.actorId,
                now: appliedAt,
              });
            setDurableConfigMode(database, {
              mode: 'file',
              fileRevision: revision.revision,
              filePath: previewRow.source_ref,
              fileSourceHash: previewRow.source_hash,
              transitionId,
              now: appliedAt,
            });
          }
          database
            .prepare(
              `INSERT INTO config_transitions
                (id, from_mode, to_mode, source_hash, expected_revision, state, actor,
                 created_at, preview_id, source_kind, source_ref, target_hash,
                 target_revision, backup_artifact_id, updated_at)
               VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              transitionId,
              input.from,
              input.to,
              previewRow.source_hash,
              input.expectedActiveRevision,
              audit.actorId,
              appliedAt,
              previewRow.id,
              previewRow.source_kind,
              previewRow.source_ref,
              previewRow.target_content_hash,
              targetRevision,
              backup.backupId,
              appliedAt
            );
          database
            .prepare(
              `UPDATE config_transition_previews
               SET target_config_json = 'null', consumed_at = ?
               WHERE id = ? AND consumed_at IS NULL`
            )
            .run(appliedAt, previewRow.id);
          return {
            mode: input.to,
            revision: targetRevision,
            contentHash: previewRow.target_content_hash,
            loadedAt: appliedAt,
            config: targetConfig,
            ...(input.to === 'file'
              ? {
                  filePath: previewRow.source_ref,
                  fileSourceHash: previewRow.source_hash,
                }
              : {}),
          } satisfies RuntimeConfigSnapshot;
        })();

        try {
          await applySnapshot(targetSnapshot);
          activated = true;
        } catch (error) {
          const errorCode = configModeTransitionErrorCode(error);
          const failedAt = now().toISOString();
          database.transaction(() => {
            restoreDurableState(database, previousDurable, failedAt);
            database
              .prepare(
                `UPDATE config_transitions
                 SET state = 'failed', error_code = ?, updated_at = ?, completed_at = ?
                 WHERE id = ? AND state = 'pending'`
              )
              .run(errorCode, failedAt, failedAt, transitionId);
            writeAudit(audit, {
              action: 'config.mode.apply',
              targetId: transitionId,
              result: 'failed',
              errorCode,
              before,
              after: targetConfig,
              details: {
                from: input.from,
                to: input.to,
                sourceHash: previewRow.source_hash,
                targetContentHash: previewRow.target_content_hash,
                backupArtifactId: backup.backupId,
                previewTokenHash: digest,
              },
            });
          })();
          try {
            await applySnapshot(before);
            runtimeRecovered = true;
          } catch (recoveryError) {
            throw new AggregateError(
              [error, recoveryError],
              'Configuration activation and runtime recovery both failed'
            );
          }
          throw error;
        }

        const completedAt = now().toISOString();
        database.transaction(() => {
          database
            .prepare(
              `UPDATE config_transitions
               SET state = 'completed', updated_at = ?, completed_at = ?
               WHERE id = ? AND state = 'pending'`
            )
            .run(completedAt, completedAt, transitionId);
          writeAudit(audit, {
            action: 'config.mode.apply',
            targetId: transitionId,
            result: 'success',
            before,
            after: targetConfig,
            details: {
              from: input.from,
              to: input.to,
              sourceHash: previewRow.source_hash,
              targetContentHash: previewRow.target_content_hash,
              targetRevision,
              backupArtifactId: backup.backupId,
              previewTokenHash: digest,
            },
          });
        })();
        return {
          transitionId,
          state: 'completed',
          mode: input.to,
          revision: targetRevision,
          contentHash: previewRow.target_content_hash,
          backupArtifactId: backup.backupId,
          recovered: false,
        };
      } finally {
        if (!activated && !runtimeRecovered) await resumeRuntime();
      }
    };
    inFlight = run().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  const recoverPending = (): ConfigModeTransitionResult | null => {
    const rows = database
      .prepare(
        `SELECT id, from_mode, to_mode, state, source_hash, target_hash, target_revision,
                backup_artifact_id, error_code, created_at, completed_at
         FROM config_transitions WHERE state = 'pending' ORDER BY created_at`
      )
      .all() as TransitionRow[];
    if (rows.length === 0) return null;
    if (rows.length > 1) {
      throw transitionError(
        'config_transition_recovery_ambiguous',
        'More than one pending configuration transition exists'
      );
    }
    const row = rows[0] as TransitionRow;
    const durable = getDurableConfigState(database);
    const snapshot = currentSnapshot();
    if (
      durable.transitionId !== row.id ||
      durable.mode !== row.to_mode ||
      snapshot.mode !== row.to_mode ||
      snapshot.contentHash !== row.target_hash ||
      (snapshot.mode === 'managed' && snapshot.revision !== row.target_revision)
    ) {
      throw transitionError(
        'config_transition_recovery_mismatch',
        'Pending transition does not match the durable active snapshot'
      );
    }
    const completedAt = now().toISOString();
    database
      .prepare(
        `UPDATE config_transitions
         SET state = 'completed', updated_at = ?, completed_at = ?
         WHERE id = ? AND state = 'pending'`
      )
      .run(completedAt, completedAt, row.id);
    return {
      transitionId: row.id,
      state: 'completed',
      mode: snapshot.mode as 'managed' | 'file',
      revision: snapshot.revision,
      contentHash: snapshot.contentHash,
      backupArtifactId: row.backup_artifact_id ?? '',
      recovered: true,
    };
  };

  const status = (): ConfigModeTransitionStatus | null => {
    const row = database
      .prepare(
        `SELECT id, from_mode, to_mode, state, source_hash, target_hash, target_revision,
                backup_artifact_id, error_code, created_at, completed_at
         FROM config_transitions ORDER BY created_at DESC LIMIT 1`
      )
      .get() as TransitionRow | undefined;
    return row ? transitionStatus(row) : null;
  };

  return {
    preview,
    apply,
    recoverPending,
    status,
    cleanupExpiredPreviews,
    isInFlight: () => inFlight !== null,
    configuredFilePath,
    inspectFileSource: async () => {
      const inspected = await inspectFileSource();
      return {
        path: inspected.path,
        sha256: inspected.sha256,
        sizeBytes: inspected.sizeBytes,
      };
    },
  };
};

export type ConfigModeTransitionService = ReturnType<typeof createConfigModeTransitionService>;
