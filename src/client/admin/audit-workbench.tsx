import { CheckCircle2, Filter, RefreshCw, ScrollText, ShieldAlert, ShieldX } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import {
  getAdminAudit,
  type AdminAuditEntry,
  type AdminAuditResult,
  type AdminSession,
} from './api';
import { auditResultLabel, auditTarget } from './audit-model';

type AuditFilters = {
  action?: string;
  result?: AdminAuditResult;
};

const resultIcon = (result: AdminAuditResult) =>
  result === 'success' ? CheckCircle2 : result === 'denied' ? ShieldX : ShieldAlert;

export const AuditWorkbench = ({ session }: { session: AdminSession }) => {
  const [entries, setEntries] = useState<AdminAuditEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [filters, setFilters] = useState<AuditFilters>({});
  const [actionDraft, setActionDraft] = useState('');
  const [resultDraft, setResultDraft] = useState<'' | AdminAuditResult>('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    async (cursor?: string) => {
      const append = Boolean(cursor);
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const response = await getAdminAudit({
          limit: 50,
          cursor,
          action: filters.action,
          result: filters.result,
        });
        setEntries(current =>
          append ? [...current, ...response.data.entries] : response.data.entries
        );
        setNextCursor(response.data.nextCursor);
      } catch (error) {
        toast.error('Admin audit is unavailable', {
          description: error instanceof Error ? error.message : undefined,
        });
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [filters]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFilters({
      ...(actionDraft.trim() ? { action: actionDraft.trim() } : {}),
      ...(resultDraft ? { result: resultDraft } : {}),
    });
  };

  const clearFilters = () => {
    setActionDraft('');
    setResultDraft('');
    setFilters({});
  };

  return (
    <div className="audit-workspace">
      <header className="workbench-page-heading audit-heading">
        <div>
          <p className="admin-eyebrow">Owner-only evidence</p>
          <h1>Every privileged decision leaves a trail.</h1>
          <p>
            This projection intentionally excludes request IDs, network metadata, user agents,
            configuration diffs, subscriber data, and secret material.
          </p>
        </div>
        <span className="mode-stamp">
          <ScrollText aria-hidden="true" size={14} /> append-only
        </span>
      </header>

      <section className="audit-surface">
        <form className="audit-filter-bar" onSubmit={applyFilters}>
          <label className="admin-field">
            <span>Exact action</span>
            <input
              maxLength={200}
              onChange={event => setActionDraft(event.target.value)}
              placeholder="retention.run"
              value={actionDraft}
            />
          </label>
          <label className="admin-field">
            <span>Result</span>
            <select
              onChange={event => setResultDraft(event.target.value as '' | AdminAuditResult)}
              value={resultDraft}
            >
              <option value="">All results</option>
              <option value="success">Succeeded</option>
              <option value="denied">Denied</option>
              <option value="failed">Failed</option>
            </select>
          </label>
          <div className="audit-filter-actions">
            <button className="admin-primary-button" disabled={loading} type="submit">
              <Filter aria-hidden="true" size={15} /> Apply
            </button>
            <button
              className="admin-secondary-button"
              disabled={loading || (!filters.action && !filters.result)}
              onClick={clearFilters}
              type="button"
            >
              Clear
            </button>
          </div>
        </form>

        <div className="audit-ledger">
          {loading ? (
            <div className="editor-empty">
              <strong>Reading the immutable trail…</strong>
            </div>
          ) : entries.length ? (
            entries.map(entry => {
              const ResultIcon = resultIcon(entry.result);
              return (
                <article key={entry.id}>
                  <span className={`audit-result-icon is-${entry.result}`}>
                    <ResultIcon aria-hidden="true" size={17} />
                  </span>
                  <div className="audit-entry-copy">
                    <strong>{entry.action}</strong>
                    <span>{auditTarget(entry)}</span>
                    {entry.errorCode ? <small>{entry.errorCode}</small> : null}
                  </div>
                  <div className="audit-entry-actor">
                    <span>{auditResultLabel(entry.result)}</span>
                    <small title={entry.actorId}>{entry.actorId.slice(0, 18)}</small>
                  </div>
                  <time dateTime={entry.occurredAt}>
                    {new Date(entry.occurredAt).toLocaleString()}
                  </time>
                </article>
              );
            })
          ) : (
            <div className="editor-empty">
              <strong>No audit entry matches this view.</strong>
              <p>Clear the exact filters or wait for the next privileged operation.</p>
            </div>
          )}
        </div>

        {nextCursor ? (
          <footer className="audit-ledger-footer">
            <span>{entries.length} entries loaded</span>
            <button
              className="admin-secondary-button"
              disabled={loadingMore}
              onClick={() => void load(nextCursor)}
              type="button"
            >
              <RefreshCw
                aria-hidden="true"
                className={loadingMore ? 'is-spinning' : ''}
                size={15}
              />
              {loadingMore ? 'Loading…' : 'Load older entries'}
            </button>
          </footer>
        ) : null}
      </section>

      <p className="audit-principal-note">
        Signed in as owner <code>{session.userId}</code>. Raw forensic metadata remains
        database-only and follows the configured retention policy.
      </p>
    </div>
  );
};
