import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArchiveRestore,
  CheckCircle2,
  DatabaseBackup,
  Eye,
  FileWarning,
  History,
  RefreshCw,
  Save,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import {
  createBackup,
  deleteEligibleBackup,
  getBackupRetentionData,
  previewRetention,
  runRetention,
  updateRetentionPolicy,
  validateBackup,
  type AdminBackupArtifact,
  type AdminRetentionPreview,
  type AdminSession,
} from './api';
import {
  canDeleteBackup,
  formatBytes,
  lifecycleErrorDescription,
  retentionCount,
} from './backup-retention-model';
import {
  backupDeleteConfirmationSchema,
  retentionPolicyDraftSchema,
  retentionRunConfirmationSchema,
  type BackupDeleteConfirmationInput,
  type RetentionPolicyDraftInput,
  type RetentionRunConfirmationInput,
} from './schemas';

type LifecycleData = Awaited<ReturnType<typeof getBackupRetentionData>>;

const candidateLabels: Record<keyof AdminRetentionPreview['candidates'], string> = {
  pendingSubscriptionsExpired: 'Pending subscriptions expired',
  terminalSubscriptionsRedacted: 'Terminal subscriber PII redacted',
  terminalDeliveryPayloadsRedacted: 'Terminal delivery payloads redacted',
  expiredSubscriptionTokensDeleted: 'Expired subscription tokens deleted',
  deliveryAttemptsDeleted: 'Old delivery attempts deleted',
  abuseRateLimitBucketsDeleted: 'Expired abuse buckets deleted',
  unpublishedTerminalEventsDeleted: 'Unpublished terminal events deleted',
  adminAuditRowsDeleted: 'Old admin audit rows deleted',
  backupArtifactsMarkedEligible: 'Backup artifacts marked eligible',
  backupArtifactsMarkedCurrent: 'Backup artifacts kept current',
};

const BackupRow = ({
  backup,
  busy,
  onValidate,
  onDelete,
}: {
  backup: AdminBackupArtifact;
  busy: boolean;
  onValidate: () => void;
  onDelete: () => void;
}) => (
  <article className="lifecycle-backup-row">
    <div className="lifecycle-backup-icon">
      <DatabaseBackup aria-hidden="true" size={18} />
    </div>
    <div className="lifecycle-backup-identity">
      <strong>{backup.id}</strong>
      <span>
        {backup.manifest?.purpose === 'schema-upgrade' ? 'Schema upgrade' : 'Runtime backup'}
        {' · '}
        {backup.manifest ? formatBytes(backup.manifest.sizeBytes) : 'Manifest unavailable'}
      </span>
      <small>
        {new Date(backup.createdAt).toLocaleString()} · schema{' '}
        {backup.manifest?.schemaVersion ?? '—'}
      </small>
    </div>
    <div className="lifecycle-backup-state">
      <span className={`lifecycle-state is-${backup.state}`}>{backup.state}</span>
      <span className={`lifecycle-state is-${backup.retentionState}`}>{backup.retentionState}</span>
      {backup.deletionState ? (
        <span className="lifecycle-state is-deleting">{backup.deletionState}</span>
      ) : null}
    </div>
    <div className="lifecycle-row-actions">
      <button
        className="admin-secondary-button"
        disabled={busy || backup.state !== 'ready' || backup.deletionState !== null}
        onClick={onValidate}
        type="button"
      >
        <Eye aria-hidden="true" size={15} /> Validate
      </button>
      {canDeleteBackup(backup) ? (
        <button className="admin-danger-button" disabled={busy} onClick={onDelete} type="button">
          <Trash2 aria-hidden="true" size={15} /> Delete
        </button>
      ) : null}
    </div>
  </article>
);

export const BackupRetention = ({
  session,
  revision,
  mode,
  onCommitted,
}: {
  session: AdminSession;
  revision: number;
  mode: 'managed' | 'file' | 'compatibility';
  onCommitted: () => Promise<void>;
}) => {
  const [data, setData] = useState<LifecycleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminBackupArtifact | null>(null);
  const [preview, setPreview] = useState<AdminRetentionPreview | null>(null);
  const policyForm = useForm<RetentionPolicyDraftInput>({
    resolver: zodResolver(retentionPolicyDraftSchema),
    defaultValues: {
      eventDraftDays: 90,
      adminAuditDays: 365,
      deliveryAttemptDays: 90,
      backupDays: 30,
    },
  });
  const deleteForm = useForm<BackupDeleteConfirmationInput>({
    resolver: zodResolver(backupDeleteConfirmationSchema),
    defaultValues: { confirmation: '' },
  });
  const runForm = useForm<RetentionRunConfirmationInput>({
    resolver: zodResolver(retentionRunConfirmationSchema),
    defaultValues: { confirmation: '' },
  });

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getBackupRetentionData();
      setData(next);
      policyForm.reset(next.policy);
    } catch (error) {
      toast.error('Backup and retention data is unavailable', {
        description: lifecycleErrorDescription(error),
      });
    } finally {
      setLoading(false);
    }
  }, [policyForm]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const beginDelete = (backup: AdminBackupArtifact) => {
    setDeleteTarget(backup);
    deleteForm.reset({ confirmation: '' });
  };

  const cancelDelete = () => {
    setDeleteTarget(null);
    deleteForm.reset({ confirmation: '' });
  };

  const makeBackup = async () => {
    setBusyId('backup-create');
    try {
      const result = await createBackup(session);
      toast.success('Verified backup created', {
        description: `${result.data.backupId} · ${formatBytes(result.data.sizeBytes)}`,
      });
      await reload();
    } catch (error) {
      toast.error('Backup creation was rejected', {
        description: lifecycleErrorDescription(error),
      });
    } finally {
      setBusyId(null);
    }
  };

  const verifyBackup = async (backupId: string) => {
    setBusyId(backupId);
    try {
      const result = await validateBackup(session, backupId);
      toast.success('Backup is restorable', {
        description: `Schema ${result.data.schemaVersion} · ${formatBytes(result.data.sizeBytes)}`,
      });
    } catch (error) {
      toast.error('Backup validation failed', {
        description: lifecycleErrorDescription(error),
      });
    } finally {
      setBusyId(null);
    }
  };

  const removeBackup = deleteForm.handleSubmit(async input => {
    if (!deleteTarget?.manifestSha256) return;
    if (input.confirmation !== deleteTarget.id) {
      deleteForm.setError('confirmation', {
        type: 'validate',
        message: 'The confirmation must exactly match the selected backup ID.',
      });
      return;
    }
    setBusyId(deleteTarget.id);
    try {
      await deleteEligibleBackup(session, deleteTarget.id, deleteTarget.manifestSha256);
      toast.success('Eligible backup deleted');
      cancelDelete();
      await reload();
    } catch (error) {
      toast.error('Backup deletion was rejected', {
        description: lifecycleErrorDescription(error),
      });
    } finally {
      setBusyId(null);
    }
  });

  const savePolicy = policyForm.handleSubmit(async policy => {
    if (mode !== 'managed' || revision < 1) return;
    setBusyId('policy');
    try {
      const result = await updateRetentionPolicy(session, revision, policy);
      setPreview(null);
      runForm.reset({ confirmation: '' });
      toast.success(`Retention policy committed as revision ${result.data.revision}`);
      await Promise.all([reload(), onCommitted()]);
    } catch (error) {
      toast.error('Retention policy was not updated', {
        description: lifecycleErrorDescription(error),
      });
    } finally {
      setBusyId(null);
    }
  });

  const inspectRetention = async () => {
    setBusyId('retention-preview');
    try {
      const result = await previewRetention(session);
      setPreview(result.data);
      runForm.reset({ confirmation: '' });
      toast.success('Retention preview is ready');
    } catch (error) {
      toast.error('Retention preview failed', {
        description: lifecycleErrorDescription(error),
      });
    } finally {
      setBusyId(null);
    }
  };

  const executeRetention = runForm.handleSubmit(async () => {
    if (!preview) return;
    setBusyId('retention-run');
    try {
      const result = await runRetention(session);
      toast.success('Retention run completed', {
        description: `${retentionCount(result.data.summary ?? preview.candidates)} lifecycle changes`,
      });
      setPreview(null);
      runForm.reset({ confirmation: '' });
      await reload();
    } catch (error) {
      toast.error('Retention run was rejected', {
        description: lifecycleErrorDescription(error),
      });
    } finally {
      setBusyId(null);
    }
  });

  if (!data) {
    return (
      <div className="workbench-loading">
        {loading ? 'Reading lifecycle metadata…' : 'Lifecycle metadata is unavailable.'}
      </div>
    );
  }

  return (
    <div className="lifecycle-workspace">
      <header className="workbench-page-heading lifecycle-heading">
        <div>
          <p className="admin-eyebrow">Owner-only data lifecycle</p>
          <h1>Backups with evidence, retention with review.</h1>
          <p>
            High-risk writes require a recent sign-in. The scheduler can classify an artifact as
            eligible, but only an owner can physically delete it.
          </p>
        </div>
        <span className="mode-stamp">
          <ShieldAlert aria-hidden="true" size={14} /> owner
        </span>
      </header>

      <section className="lifecycle-section">
        <header className="lifecycle-section-heading">
          <div>
            <p className="admin-eyebrow">Restorable artifacts</p>
            <h2>Backup ledger</h2>
            <p>Every validation rechecks the SQLite header, manifest, checksum, and migrations.</p>
          </div>
          <button
            className="admin-primary-button"
            disabled={busyId !== null}
            onClick={() => void makeBackup()}
            type="button"
          >
            <DatabaseBackup aria-hidden="true" size={16} />
            {busyId === 'backup-create' ? 'Creating…' : 'Create backup'}
          </button>
        </header>
        <div className="lifecycle-backup-list">
          {data.backups.length ? (
            data.backups.map(backup => (
              <BackupRow
                backup={backup}
                busy={busyId !== null}
                key={backup.id}
                onDelete={() => beginDelete(backup)}
                onValidate={() => void verifyBackup(backup.id)}
              />
            ))
          ) : (
            <div className="editor-empty">
              <strong>No backup artifact recorded.</strong>
              <p>Create and validate the first recovery point.</p>
            </div>
          )}
        </div>
        {deleteTarget ? (
          <form className="rollback-review lifecycle-danger-review" onSubmit={removeBackup}>
            <div>
              <p className="admin-eyebrow">Physical deletion review</p>
              <h3>Delete {deleteTarget.id}</h3>
              <p>
                This removes the artifact and its manifest. Paste the complete backup ID to bind
                this confirmation to the reviewed ledger row.
              </p>
            </div>
            <label className="admin-field">
              <span>Backup ID</span>
              <input
                autoComplete="off"
                spellCheck={false}
                {...deleteForm.register('confirmation')}
              />
              {deleteForm.formState.errors.confirmation ? (
                <small className="admin-form-error">
                  {deleteForm.formState.errors.confirmation.message}
                </small>
              ) : null}
            </label>
            <div className="rollback-actions">
              <button
                className="admin-secondary-button"
                disabled={busyId !== null}
                onClick={cancelDelete}
                type="button"
              >
                Cancel
              </button>
              <button className="admin-danger-button" disabled={busyId !== null} type="submit">
                <Trash2 aria-hidden="true" size={16} />
                {busyId === deleteTarget.id ? 'Deleting…' : 'Delete eligible backup'}
              </button>
            </div>
          </form>
        ) : null}
      </section>

      <div className="lifecycle-grid">
        <section className="lifecycle-section">
          <header className="lifecycle-section-heading">
            <div>
              <p className="admin-eyebrow">Versioned configuration</p>
              <h2>Retention policy</h2>
              <p>All values are days. Longer windows preserve more operational history.</p>
            </div>
            <History aria-hidden="true" size={21} />
          </header>
          <form className="admin-form lifecycle-policy-form" onSubmit={savePolicy}>
            <div className="admin-form-row">
              <label className="admin-field">
                <span>Unpublished event drafts</span>
                <input
                  disabled={mode !== 'managed'}
                  type="number"
                  {...policyForm.register('eventDraftDays', { valueAsNumber: true })}
                />
                {policyForm.formState.errors.eventDraftDays ? (
                  <small className="admin-form-error">
                    {policyForm.formState.errors.eventDraftDays.message}
                  </small>
                ) : null}
              </label>
              <label className="admin-field">
                <span>Admin audit history</span>
                <input
                  disabled={mode !== 'managed'}
                  type="number"
                  {...policyForm.register('adminAuditDays', { valueAsNumber: true })}
                />
                {policyForm.formState.errors.adminAuditDays ? (
                  <small className="admin-form-error">
                    {policyForm.formState.errors.adminAuditDays.message}
                  </small>
                ) : null}
              </label>
            </div>
            <div className="admin-form-row">
              <label className="admin-field">
                <span>Delivery attempts</span>
                <input
                  disabled={mode !== 'managed'}
                  type="number"
                  {...policyForm.register('deliveryAttemptDays', { valueAsNumber: true })}
                />
                {policyForm.formState.errors.deliveryAttemptDays ? (
                  <small className="admin-form-error">
                    {policyForm.formState.errors.deliveryAttemptDays.message}
                  </small>
                ) : null}
              </label>
              <label className="admin-field">
                <span>Backup artifacts</span>
                <input
                  disabled={mode !== 'managed'}
                  type="number"
                  {...policyForm.register('backupDays', { valueAsNumber: true })}
                />
                {policyForm.formState.errors.backupDays ? (
                  <small className="admin-form-error">
                    {policyForm.formState.errors.backupDays.message}
                  </small>
                ) : null}
              </label>
            </div>
            {mode === 'managed' ? (
              <button
                className="admin-secondary-button"
                disabled={busyId !== null || !policyForm.formState.isDirty}
                type="submit"
              >
                <Save aria-hidden="true" size={16} />
                {busyId === 'policy' ? 'Committing…' : 'Commit policy revision'}
              </button>
            ) : (
              <p className="lifecycle-read-only">
                File and compatibility modes expose this policy read-only. Change the source
                configuration and reload it.
              </p>
            )}
          </form>
        </section>

        <section className="lifecycle-section">
          <header className="lifecycle-section-heading">
            <div>
              <p className="admin-eyebrow">Preview before mutation</p>
              <h2>Retention execution</h2>
              <p>A new preview is required after every policy update or completed run.</p>
            </div>
            <ArchiveRestore aria-hidden="true" size={21} />
          </header>
          <button
            className="admin-secondary-button"
            disabled={busyId !== null}
            onClick={() => void inspectRetention()}
            type="button"
          >
            <Eye aria-hidden="true" size={16} />
            {busyId === 'retention-preview' ? 'Counting…' : 'Preview candidates'}
          </button>
          {preview ? (
            <div className="retention-preview">
              <div className="retention-preview-total">
                <CheckCircle2 aria-hidden="true" size={18} />
                <div>
                  <strong>{retentionCount(preview.candidates)} candidate changes</strong>
                  <span>Policy protocol v{preview.policyVersion}</span>
                </div>
              </div>
              <dl>
                {Object.entries(preview.candidates).map(([key, count]) => (
                  <div key={key}>
                    <dt>{candidateLabels[key as keyof typeof candidateLabels]}</dt>
                    <dd>{count}</dd>
                  </div>
                ))}
              </dl>
              <form className="lifecycle-run-review" onSubmit={executeRetention}>
                <div>
                  <FileWarning aria-hidden="true" size={18} />
                  <p>
                    Enter <strong>RUN RETENTION</strong> to execute this reviewed policy. Physical
                    backup deletion is still excluded.
                  </p>
                </div>
                <label className="admin-field">
                  <span>Execution confirmation</span>
                  <input
                    autoComplete="off"
                    spellCheck={false}
                    {...runForm.register('confirmation')}
                  />
                  {runForm.formState.errors.confirmation ? (
                    <small className="admin-form-error">
                      {runForm.formState.errors.confirmation.message}
                    </small>
                  ) : null}
                </label>
                <button className="admin-danger-button" disabled={busyId !== null} type="submit">
                  <RefreshCw
                    aria-hidden="true"
                    className={busyId === 'retention-run' ? 'is-spinning' : ''}
                    size={16}
                  />
                  {busyId === 'retention-run' ? 'Running…' : 'Run reviewed retention'}
                </button>
              </form>
            </div>
          ) : null}
        </section>
      </div>

      <section className="lifecycle-section">
        <header className="lifecycle-section-heading">
          <div>
            <p className="admin-eyebrow">Immutable execution history</p>
            <h2>Recent retention runs</h2>
          </div>
          <span>{data.runs.length}</span>
        </header>
        <div className="retention-run-ledger">
          {data.runs.length ? (
            data.runs.map(run => (
              <article key={run.id}>
                <span className={`lifecycle-state is-${run.state}`}>{run.state}</span>
                <div>
                  <strong>{run.trigger}</strong>
                  <small>{run.actorId}</small>
                </div>
                <span>{run.summary ? `${retentionCount(run.summary)} changes` : 'No summary'}</span>
                <time>{new Date(run.startedAt).toLocaleString()}</time>
              </article>
            ))
          ) : (
            <div className="editor-empty">
              <strong>No retention run recorded.</strong>
              <p>The preview remains non-mutating and does not enter this ledger.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
