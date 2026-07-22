import {
  CalendarClock,
  Clock3,
  FileCheck2,
  MessageSquareText,
  Siren,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AdminIncident, AdminNativeEvent, AdminPage, AdminSession } from './api';
import { IncidentComposer, IncidentReview } from './incident-desk';
import { SecondaryEventComposer, SecondaryEventReview } from './secondary-event-desk';

const eventKey = (event: AdminNativeEvent) => `${event.type}:${event.id}`;

const eventIcons: Record<AdminNativeEvent['type'], LucideIcon> = {
  incident: Siren,
  maintenance: CalendarClock,
  notice: MessageSquareText,
  postmortem: FileCheck2,
};

export const EventWorkspace = ({
  session,
  pages,
  incidents,
  events,
  onCommitted,
}: {
  session: AdminSession;
  pages: AdminPage[];
  incidents: AdminIncident[];
  events: AdminNativeEvent[];
  onCommitted: () => Promise<void>;
}) => {
  const [selectedKey, setSelectedKey] = useState<string | null>(
    events[0] ? eventKey(events[0]) : null
  );
  useEffect(() => {
    if (!selectedKey || !events.some(event => eventKey(event) === selectedKey)) {
      setSelectedKey(events[0] ? eventKey(events[0]) : null);
    }
  }, [events, selectedKey]);
  const selected = events.find(event => eventKey(event) === selectedKey) ?? null;
  const canDraft = session.role !== 'viewer';
  const canPublish = session.role === 'owner' || session.role === 'publisher';

  return (
    <div className="event-workspace">
      <section className="event-ledger">
        <header>
          <div>
            <p className="admin-eyebrow">Public activity</p>
            <h2>Native events</h2>
          </div>
          <span>{events.length}</span>
        </header>
        {events.length > 0 ? (
          <div className="event-list">
            {events.map(event => {
              const Icon = eventIcons[event.type];
              const key = eventKey(event);
              return (
                <button
                  className={key === selectedKey ? 'is-selected' : ''}
                  key={key}
                  onClick={() => setSelectedKey(key)}
                  type="button"
                >
                  <Icon size={17} />
                  <span>
                    <strong>{event.title}</strong>
                    <small>
                      {event.type} · {event.state} · v{event.version} · {event.pageId}
                    </small>
                  </span>
                  <time>
                    <Clock3 size={13} /> {new Date(event.updatedAt).toLocaleDateString()}
                  </time>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="editor-empty">
            <strong>No native event yet.</strong>
            <p>Signals stay separate until an operator creates a public event draft.</p>
          </div>
        )}
      </section>
      <div className="event-action-column">
        {selected && canDraft ? (
          selected.type === 'incident' ? (
            <IncidentReview
              session={session}
              incident={selected}
              canPublish={canPublish}
              onCommitted={onCommitted}
            />
          ) : (
            <SecondaryEventReview
              session={session}
              event={selected}
              canPublish={canPublish}
              onCommitted={onCommitted}
            />
          )
        ) : null}
        {selected && !canDraft ? (
          <section className="incident-review">
            <header>
              <div>
                <p className="admin-eyebrow">
                  Selected {selected.type} · v{selected.version}
                </p>
                <h2>{selected.title}</h2>
              </div>
              <span className={`incident-state state-${selected.state}`}>{selected.state}</span>
            </header>
            <div className="incident-current-copy">
              <strong>Latest append-only entry</strong>
              <p>{selected.latestEntry.body}</p>
            </div>
          </section>
        ) : null}
        {canDraft ? (
          <>
            <IncidentComposer session={session} pages={pages} onCommitted={onCommitted} />
            <SecondaryEventComposer
              session={session}
              pages={pages}
              incidents={incidents}
              onCommitted={onCommitted}
            />
          </>
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
