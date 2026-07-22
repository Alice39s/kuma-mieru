import { Clock3, Siren } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AdminIncident, AdminPage, AdminSession } from './api';
import { IncidentComposer, IncidentReview } from './incident-desk';

export const EventWorkspace = ({
  session,
  pages,
  incidents,
  onCommitted,
}: {
  session: AdminSession;
  pages: AdminPage[];
  incidents: AdminIncident[];
  onCommitted: () => Promise<void>;
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(incidents[0]?.id ?? null);
  useEffect(() => {
    if (!selectedId || !incidents.some(incident => incident.id === selectedId)) {
      setSelectedId(incidents[0]?.id ?? null);
    }
  }, [incidents, selectedId]);
  const selected = incidents.find(incident => incident.id === selectedId) ?? null;
  const canDraft = session.role !== 'viewer';
  const canPublish = session.role === 'owner' || session.role === 'publisher';

  return (
    <div className="event-workspace">
      <section className="event-ledger">
        <header>
          <div>
            <p className="admin-eyebrow">Public activity</p>
            <h2>Native incidents</h2>
          </div>
          <span>{incidents.length}</span>
        </header>
        {incidents.length > 0 ? (
          <div className="event-list">
            {incidents.map(incident => (
              <button
                className={incident.id === selectedId ? 'is-selected' : ''}
                key={incident.id}
                onClick={() => setSelectedId(incident.id)}
                type="button"
              >
                <Siren size={17} />
                <span>
                  <strong>{incident.title}</strong>
                  <small>
                    {incident.state} · v{incident.version} · {incident.pageId}
                  </small>
                </span>
                <time>
                  <Clock3 size={13} /> {new Date(incident.updatedAt).toLocaleDateString()}
                </time>
              </button>
            ))}
          </div>
        ) : (
          <div className="editor-empty">
            <strong>No native event yet.</strong>
            <p>Signals stay separate until an operator creates an incident draft.</p>
          </div>
        )}
      </section>
      <div className="event-action-column">
        {selected && canDraft ? (
          <IncidentReview
            session={session}
            incident={selected}
            canPublish={canPublish}
            onCommitted={onCommitted}
          />
        ) : null}
        {canDraft ? (
          <IncidentComposer session={session} pages={pages} onCommitted={onCommitted} />
        ) : (
          <section className="workbench-editor read-only-panel">
            <p className="admin-eyebrow">Viewer boundary</p>
            <h2>Events are read-only.</h2>
            <p>The Viewer role can inspect public activity but cannot create drafts.</p>
          </section>
        )}
      </div>
    </div>
  );
};
