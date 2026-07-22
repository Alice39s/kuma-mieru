import {
  Activity,
  ArrowUpRight,
  BookOpenCheck,
  Boxes,
  CircleGauge,
  FileClock,
  LayoutTemplate,
  LogOut,
  RadioTower,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Siren,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { getWorkbenchData, rollbackRevision, signOut, type AdminSession } from './api';
import { PageForm } from './page-form';
import { SourceWizard } from './source-wizard';
import { EventWorkspace } from './event-workspace';

type Panel = 'overview' | 'sources' | 'pages' | 'events' | 'revisions';
type WorkbenchData = Awaited<ReturnType<typeof getWorkbenchData>>;

const navigation: Array<{ id: Panel; label: string; icon: typeof Activity }> = [
  { id: 'overview', label: 'Overview', icon: CircleGauge },
  { id: 'sources', label: 'Sources', icon: RadioTower },
  { id: 'pages', label: 'Pages', icon: LayoutTemplate },
  { id: 'events', label: 'Events', icon: Siren },
  { id: 'revisions', label: 'Revisions', icon: FileClock },
];

const Overview = ({ data }: { data: WorkbenchData }) => (
  <div className="workbench-overview">
    <header className="workbench-page-heading">
      <div>
        <p className="admin-eyebrow">Operational summary</p>
        <h1>The system is quiet.</h1>
        <p>
          Configuration is active, revisioned, and served without visitor-triggered upstream work.
        </p>
      </div>
      <span className={`mode-stamp mode-${data.meta.config.mode}`}>{data.meta.config.mode}</span>
    </header>
    <div className="metric-ledger">
      <article>
        <span>Active revision</span>
        <strong>r{data.meta.config.revision ?? '—'}</strong>
        <small>{data.meta.config.contentHash.slice(0, 12)}</small>
      </article>
      <article>
        <span>Configured sources</span>
        <strong>{data.sources.length}</strong>
        <small>Uptime Kuma public adapters</small>
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
  const canEdit =
    data?.meta.config.mode === 'managed' && (session.role === 'owner' || session.role === 'editor');

  return (
    <div className="workbench-shell">
      <aside className="workbench-nav">
        <Link className="workbench-brand" to="/">
          <span>
            <Activity size={19} />
          </span>
          <div>
            <strong>Kuma Mieru</strong>
            <small>Control plane</small>
          </div>
        </Link>
        <nav>
          {navigation.map(item => {
            const Icon = item.icon;
            return (
              <button
                className={panel === item.id ? 'is-active' : ''}
                key={item.id}
                onClick={() => setPanel(item.id)}
                type="button"
              >
                <Icon size={17} />
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
      <main className="workbench-main">
        <div className="workbench-topline">
          <span>
            <Boxes size={16} /> Runtime configuration
          </span>
          <button onClick={() => void reload()} type="button">
            <RefreshCw className={loading ? 'is-spinning' : ''} size={15} /> Refresh
          </button>
        </div>
        {!data ? (
          <div className="workbench-loading">Reading the active revision…</div>
        ) : (
          <>
            {panel === 'overview' ? <Overview data={data} /> : null}
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
                onCommitted={reload}
              />
            ) : null}
            {panel === 'revisions' ? (
              <RevisionLedger data={data} session={session} onCommitted={reload} />
            ) : null}
          </>
        )}
      </main>
    </div>
  );
};
