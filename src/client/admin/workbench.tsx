import {
  Activity,
  ArrowUpRight,
  BookOpenCheck,
  Boxes,
  CircleGauge,
  DatabaseBackup,
  FileClock,
  KeyRound,
  LayoutTemplate,
  LogOut,
  RadioTower,
  RefreshCw,
  RotateCcw,
  ScrollText,
  ShieldCheck,
  Siren,
  UserCog,
  UsersRound,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import {
  getWorkbenchData,
  reloadFileConfig,
  rollbackRevision,
  signOut,
  type AdminSession,
} from './api';
import { PageForm } from './page-form';
import { SourceWizard } from './source-wizard';
import { EventWorkspace } from './event-workspace';
import { SubscriberDelivery } from './subscriber-delivery';
import { BackupRetention } from './backup-retention';
import { canAccessLifecycle } from './backup-retention-model';
import { AuditWorkbench } from './audit-workbench';
import { canAccessAdminAudit } from './audit-model';
import { UsersSessions } from './users-sessions';
import { canAccessUsers } from './users-model';
import { SecurityWorkbench } from './security-workbench';

type Panel =
  | 'overview'
  | 'sources'
  | 'pages'
  | 'events'
  | 'subscribers'
  | 'revisions'
  | 'lifecycle'
  | 'access'
  | 'security'
  | 'audit';
type WorkbenchData = Awaited<ReturnType<typeof getWorkbenchData>>;

const navigation: Array<{ id: Panel; label: string; icon: typeof Activity }> = [
  { id: 'overview', label: 'Overview', icon: CircleGauge },
  { id: 'sources', label: 'Sources', icon: RadioTower },
  { id: 'pages', label: 'Pages', icon: LayoutTemplate },
  { id: 'events', label: 'Events', icon: Siren },
  { id: 'subscribers', label: 'Subscribers', icon: UsersRound },
  { id: 'revisions', label: 'Revisions', icon: FileClock },
  { id: 'lifecycle', label: 'Lifecycle', icon: DatabaseBackup },
  { id: 'access', label: 'Access', icon: UserCog },
  { id: 'security', label: 'Security', icon: KeyRound },
  { id: 'audit', label: 'Audit', icon: ScrollText },
];

const Overview = ({
  data,
  session,
  reloadingFile,
  onReloadFile,
}: {
  data: WorkbenchData;
  session: AdminSession;
  reloadingFile: boolean;
  onReloadFile: () => Promise<void>;
}) => (
  <div className="workbench-overview">
    <header className="workbench-page-heading">
      <div>
        <p className="admin-eyebrow">Operational summary</p>
        <h1>The system is quiet.</h1>
        <p>
          {data.meta.config.mode === 'managed'
            ? 'Configuration is active, revisioned, and served without visitor-triggered upstream work.'
            : 'Configuration is active from a validated file snapshot; failed reloads retain the last-known-good state.'}
        </p>
      </div>
      <span className={`mode-stamp mode-${data.meta.config.mode}`}>{data.meta.config.mode}</span>
    </header>
    <div className="metric-ledger">
      <article>
        <span>
          {data.meta.config.mode === 'managed' ? 'Active revision' : 'Active file snapshot'}
        </span>
        <strong>
          {data.meta.config.mode === 'managed' ? `r${data.meta.config.revision ?? '—'}` : 'GitOps'}
        </strong>
        <small>{data.meta.config.contentHash.slice(0, 12)}</small>
      </article>
      <article>
        <span>Configured sources</span>
        <strong>{data.sources.length}</strong>
        <small>Public read-only adapters</small>
      </article>
      <article>
        <span>Published pages</span>
        <strong>{data.pages.length}</strong>
        <small>Path-routed public surfaces</small>
      </article>
    </div>
    <section className="attention-queue">
      <div className="queue-heading">
        <BookOpenCheck size={19} />
        <div>
          <strong>Operator queue</strong>
          <span>Only work that needs a decision appears here.</span>
        </div>
      </div>
      {data.sources.length === 0 ? (
        <p>Connect and verify the first source.</p>
      ) : data.pages.length === 0 ? (
        <p>Compose a public page from the verified source.</p>
      ) : (
        <p className="queue-clear">
          <ShieldCheck size={16} /> No configuration action is waiting.
        </p>
      )}
    </section>
    {data.meta.config.mode === 'file' && data.meta.config.reload ? (
      <section className={`file-reload-card is-${data.meta.config.reload.state}`}>
        <div>
          <p className="admin-eyebrow">File mode integrity</p>
          <h2>
            {data.meta.config.reload.state === 'failed'
              ? 'Candidate rejected; serving last-known-good.'
              : 'Validated file snapshot is active.'}
          </h2>
          <p>
            Last successful load {new Date(data.meta.config.reload.lastSuccessAt).toLocaleString()}.
            {data.meta.config.reload.lastErrorCode
              ? ` Error: ${data.meta.config.reload.lastErrorCode}.`
              : ' Periodic stat and hash checks are running.'}
            {data.meta.config.reload.failedHash
              ? ` Candidate ${data.meta.config.reload.failedHash.slice(0, 12)}.`
              : ''}
          </p>
        </div>
        {session.role === 'owner' ? (
          <button
            className="admin-secondary-button"
            disabled={reloadingFile}
            onClick={() => void onReloadFile()}
            type="button"
          >
            <RefreshCw className={reloadingFile ? 'is-spinning' : ''} size={16} />
            {reloadingFile ? 'Validating…' : 'Validate and reload'}
          </button>
        ) : null}
      </section>
    ) : null}
    {data.meta.config.mode === 'compatibility' && data.meta.config.compatibility ? (
      <section className="compatibility-card">
        <div>
          <p className="admin-eyebrow">v1 compatibility profile</p>
          <h2>Legacy configuration is active and read-only.</h2>
          <p>
            {data.meta.config.compatibility.decisions.length} variables were classified;{' '}
            {data.meta.config.compatibility.ignoredFields.length} retain no effect under the safer
            v2 runtime. Run <code>bun run migrate-v1 -- --dry-run</code> before switching to Managed
            Mode.
          </p>
        </div>
        <span>{data.meta.config.compatibility.source.replaceAll('_', ' ')}</span>
      </section>
    ) : null}
  </div>
);

const SourceList = ({ data }: { data: WorkbenchData }) => (
  <section className="entity-ledger">
    <header>
      <div>
        <p className="admin-eyebrow">Inventory</p>
        <h2>Committed sources</h2>
      </div>
      <span>{data.sources.length}</span>
    </header>
    {data.sources.length ? (
      data.sources.map(source => (
        <article key={source.id}>
          <span className="entity-icon">
            <RadioTower size={18} />
          </span>
          <div>
            <strong>{source.id}</strong>
            <small>{source.baseUrl}</small>
          </div>
          <div className="entity-meta">
            <span>
              {source.pageIds.length} page{source.pageIds.length === 1 ? '' : 's'}
            </span>
            <span>{source.kind}</span>
          </div>
        </article>
      ))
    ) : (
      <div className="editor-empty">
        <strong>No source committed.</strong>
        <p>Use the verification workflow alongside this ledger.</p>
      </div>
    )}
  </section>
);

const PageList = ({ data }: { data: WorkbenchData }) => (
  <section className="entity-ledger">
    <header>
      <div>
        <p className="admin-eyebrow">Public surfaces</p>
        <h2>Published pages</h2>
      </div>
      <span>{data.pages.length}</span>
    </header>
    {data.pages.length ? (
      data.pages.map(page => (
        <article key={page.id}>
          <span className="entity-icon">
            <LayoutTemplate size={18} />
          </span>
          <div>
            <strong>{page.title}</strong>
            <small>/status/{page.slug}</small>
          </div>
          <Link className="entity-link" to={`/status/${page.slug}`}>
            <ArrowUpRight size={17} /> View
          </Link>
        </article>
      ))
    ) : (
      <div className="editor-empty">
        <strong>No public page yet.</strong>
        <p>Compose one from a committed source.</p>
      </div>
    )}
  </section>
);

const ReadOnlyPanel = ({ mode, role }: { mode: AdminMetaMode; role: AdminSession['role'] }) => (
  <section className="workbench-editor read-only-panel">
    <p className="admin-eyebrow">Read-only boundary</p>
    <h2>Changes are unavailable.</h2>
    <p>
      {mode !== 'managed'
        ? `This instance is running in ${mode} mode. Edit its source configuration and reload the service.`
        : `The ${role} role can inspect configuration but cannot create revisions.`}
    </p>
  </section>
);

type AdminMetaMode = WorkbenchData['meta']['config']['mode'];

const RevisionLedger = ({
  data,
  session,
  onCommitted,
}: {
  data: WorkbenchData;
  session: AdminSession;
  onCommitted: () => Promise<void>;
}) => {
  const [target, setTarget] = useState<number | null>(null);
  const [reason, setReason] = useState('Restore a known-good configuration');
  const rollback = async () => {
    if (!target || !data.meta.config.revision) return;
    try {
      const result = await rollbackRevision(session, target, {
        expectedRevision: data.meta.config.revision,
        reason,
      });
      toast.success(`Rollback became revision ${result.data.revision}`);
      setTarget(null);
      await onCommitted();
    } catch (error) {
      toast.error('Rollback was rejected', {
        description: error instanceof Error ? error.message : 'A recent sign-in may be required.',
      });
    }
  };

  return (
    <section className="revision-ledger">
      <header>
        <div>
          <p className="admin-eyebrow">Immutable history</p>
          <h2>Configuration revisions</h2>
        </div>
        <FileClock size={22} />
      </header>
      <div className="revision-table">
        {data.revisions.map(revision => (
          <article
            key={revision.revision}
            className={revision.revision === data.meta.config.revision ? 'is-active' : ''}
          >
            <strong>r{revision.revision}</strong>
            <span>{revision.contentHash.slice(0, 12)}</span>
            <span>{revision.actor}</span>
            <time>{new Date(revision.createdAt).toLocaleString()}</time>
            {revision.revision === data.meta.config.revision ? (
              <em>Active</em>
            ) : session.role === 'owner' && data.meta.config.mode === 'managed' ? (
              <button onClick={() => setTarget(revision.revision)} type="button">
                <RotateCcw size={14} /> Roll back
              </button>
            ) : null}
          </article>
        ))}
      </div>
      {target ? (
        <div className="rollback-review">
          <div>
            <p className="admin-eyebrow">High-risk review</p>
            <h3>Create a new revision from r{target}</h3>
          </div>
          <label className="admin-field">
            <span>Audit reason</span>
            <input value={reason} onChange={event => setReason(event.target.value)} />
          </label>
          <div className="rollback-actions">
            <button
              className="admin-secondary-button"
              onClick={() => setTarget(null)}
              type="button"
            >
              Cancel
            </button>
            <button className="admin-danger-button" onClick={rollback} type="button">
              <RotateCcw size={16} /> Confirm rollback
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
};

export const Workbench = ({
  session,
  onSignedOut,
}: {
  session: AdminSession;
  onSignedOut: () => void;
}) => {
  const [panel, setPanel] = useState<Panel>('overview');
  const [data, setData] = useState<WorkbenchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadingFile, setReloadingFile] = useState(false);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getWorkbenchData());
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        error.status === 401
      ) {
        onSignedOut();
        return;
      }
      toast.error('Workbench data is unavailable', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [onSignedOut]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const leave = async () => {
    try {
      await signOut();
    } finally {
      onSignedOut();
    }
  };
  const triggerFileReload = async () => {
    setReloadingFile(true);
    try {
      const result = await reloadFileConfig(session);
      toast.success(
        result.data.outcome === 'applied' ? 'File snapshot activated' : 'File snapshot unchanged'
      );
      await reload();
    } catch (error) {
      toast.error('File snapshot was rejected', {
        description: error instanceof Error ? error.message : 'The last-known-good remains active.',
      });
      await reload();
    } finally {
      setReloadingFile(false);
    }
  };
  const canEdit =
    data?.meta.config.mode === 'managed' && (session.role === 'owner' || session.role === 'editor');

  return (
    <div className="workbench-shell">
      <a className="admin-skip-link" href="#admin-main">
        Skip to control-plane content
      </a>
      <aside className="workbench-nav">
        <Link aria-label="Public status" className="workbench-brand" to="/">
          <span>
            <Activity aria-hidden="true" size={19} />
          </span>
          <div>
            <strong>Kuma Mieru</strong>
            <small>Control plane</small>
          </div>
        </Link>
        <nav aria-label="Control plane">
          {navigation
            .filter(
              item =>
                (item.id !== 'subscribers' ||
                  session.role === 'owner' ||
                  session.role === 'publisher') &&
                (item.id !== 'lifecycle' || canAccessLifecycle(session.role)) &&
                (item.id !== 'access' || canAccessUsers(session.role)) &&
                (item.id !== 'audit' || canAccessAdminAudit(session.role))
            )
            .map(item => {
              const Icon = item.icon;
              return (
                <button
                  aria-current={panel === item.id ? 'page' : undefined}
                  aria-label={item.label}
                  className={panel === item.id ? 'is-active' : ''}
                  key={item.id}
                  onClick={() => setPanel(item.id)}
                  type="button"
                >
                  <Icon aria-hidden="true" size={17} />
                  <span>{item.label}</span>
                </button>
              );
            })}
        </nav>
        <div className="workbench-identity">
          <span>{session.role}</span>
          <small>{session.userId.slice(0, 12)}</small>
          <button onClick={leave} type="button">
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </aside>
      <main className="workbench-main" id="admin-main" tabIndex={-1}>
        <div className="workbench-topline">
          <span>
            <Boxes aria-hidden="true" size={16} /> Runtime configuration
          </span>
          <div className="workbench-topline-actions">
            <button
              aria-label="Sign out"
              className="workbench-mobile-signout"
              onClick={leave}
              type="button"
            >
              <LogOut aria-hidden="true" size={15} />
              <span>Sign out</span>
            </button>
            <button onClick={() => void reload()} type="button">
              <RefreshCw aria-hidden="true" className={loading ? 'is-spinning' : ''} size={15} />{' '}
              Refresh
            </button>
          </div>
        </div>
        {!data ? (
          <div className="workbench-loading">Reading the active revision…</div>
        ) : (
          <>
            {panel === 'overview' ? (
              <Overview
                data={data}
                session={session}
                reloadingFile={reloadingFile}
                onReloadFile={triggerFileReload}
              />
            ) : null}
            {panel === 'sources' ? (
              <div className="workbench-split">
                <SourceList data={data} />
                {canEdit ? (
                  <SourceWizard
                    session={session}
                    revision={data.meta.config.revision ?? 0}
                    onCommitted={reload}
                  />
                ) : (
                  <ReadOnlyPanel mode={data.meta.config.mode} role={session.role} />
                )}
              </div>
            ) : null}
            {panel === 'pages' ? (
              <div className="workbench-split">
                <PageList data={data} />
                {canEdit ? (
                  <PageForm
                    session={session}
                    revision={data.meta.config.revision ?? 0}
                    sources={data.sources}
                    onCommitted={reload}
                  />
                ) : (
                  <ReadOnlyPanel mode={data.meta.config.mode} role={session.role} />
                )}
              </div>
            ) : null}
            {panel === 'events' ? (
              <EventWorkspace
                session={session}
                pages={data.pages}
                incidents={data.incidents}
                events={data.events}
                eventTemplates={data.eventTemplates}
                automationSuggestions={data.automationSuggestions}
                mirroredEvents={data.mirroredEvents}
                onCommitted={reload}
              />
            ) : null}
            {panel === 'subscribers' ? (
              <SubscriberDelivery
                session={session}
                revision={data.meta.config.revision ?? 0}
                mode={data.meta.config.mode}
                onCommitted={reload}
              />
            ) : null}
            {panel === 'revisions' ? (
              <RevisionLedger data={data} session={session} onCommitted={reload} />
            ) : null}
            {panel === 'lifecycle' && canAccessLifecycle(session.role) ? (
              <BackupRetention
                mode={data.meta.config.mode}
                onCommitted={reload}
                revision={data.meta.config.revision ?? 0}
                session={session}
              />
            ) : null}
            {panel === 'access' && canAccessUsers(session.role) ? (
              <UsersSessions session={session} />
            ) : null}
            {panel === 'security' ? <SecurityWorkbench session={session} /> : null}
            {panel === 'audit' && canAccessAdminAudit(session.role) ? (
              <AuditWorkbench session={session} />
            ) : null}
          </>
        )}
      </main>
    </div>
  );
};
