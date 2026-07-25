import {
  CalendarClock,
  Check,
  Clock3,
  ExternalLink,
  FileCheck2,
  History,
  MessageSquareText,
  Siren,
  WandSparkles,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  acceptAutomationSuggestion,
  ignoreAutomationSuggestion,
  type AdminAutomationSuggestion,
  type AdminEventTemplate,
  type AdminIncident,
  type AdminMirroredEvent,
  type AdminNativeEvent,
  type AdminPage,
  type AdminSession,
} from './api';
import { IncidentComposer, IncidentReview } from './incident-desk';
import { SecondaryEventComposer, SecondaryEventReview } from './secondary-event-desk';
import { EventTemplateLibrary } from './event-template-library';

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
  eventTemplates,
  automationSuggestions,
  mirroredEvents,
  onCommitted,
}: {
  session: AdminSession;
  pages: AdminPage[];
  incidents: AdminIncident[];
  events: AdminNativeEvent[];
  eventTemplates: AdminEventTemplate[];
  automationSuggestions: AdminAutomationSuggestion[];
  mirroredEvents: AdminMirroredEvent[];
  onCommitted: () => Promise<void>;
}) => {
  const [selectedKey, setSelectedKey] = useState<string | null>(
    events[0] ? eventKey(events[0]) : null
  );
  const [busySuggestionId, setBusySuggestionId] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedKey || !events.some(event => eventKey(event) === selectedKey)) {
      setSelectedKey(events[0] ? eventKey(events[0]) : null);
    }
  }, [events, selectedKey]);
  const selected = events.find(event => eventKey(event) === selectedKey) ?? null;
  const canDraft = session.role !== 'viewer';
  const canPublish = session.role === 'owner' || session.role === 'publisher';
  const acceptSuggestion = async (suggestion: AdminAutomationSuggestion) => {
    setBusySuggestionId(suggestion.id);
    try {
      const result = await acceptAutomationSuggestion(session, suggestion);
      toast.success(
        suggestion.kind === 'recovery'
          ? 'Recovery appended as a private native update'
          : 'Suggestion accepted as a private incident draft',
        { description: `Native incident ${result.data.incident.id.slice(0, 12)} is not published.` }
      );
      await onCommitted();
    } catch (error) {
      toast.error('Suggestion was not accepted', {
        description: error instanceof Error ? error.message : 'Refresh the evidence and retry.',
      });
    } finally {
      setBusySuggestionId(null);
    }
  };
  const ignoreSuggestion = async (suggestion: AdminAutomationSuggestion) => {
    setBusySuggestionId(suggestion.id);
    try {
      await ignoreAutomationSuggestion(session, suggestion);
      toast.success('Suggestion ignored', {
        description: 'The configured cooldown now suppresses an immediate repeat.',
      });
      await onCommitted();
    } catch (error) {
      toast.error('Suggestion was not ignored', {
        description: error instanceof Error ? error.message : 'Refresh the evidence and retry.',
      });
    } finally {
      setBusySuggestionId(null);
    }
  };

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
        <header className="mirrored-event-heading">
          <div>
            <p className="admin-eyebrow">Debounced and private</p>
            <h2>Automation suggestions</h2>
          </div>
          <span>{automationSuggestions.length}</span>
        </header>
        {automationSuggestions.length > 0 ? (
          <div className="automation-suggestion-list">
            {automationSuggestions.map(suggestion => (
              <article key={suggestion.id}>
                <div className="automation-suggestion-copy">
                  <WandSparkles size={17} />
                  <span>
                    <strong>{suggestion.title}</strong>
                    <small>
                      {suggestion.kind} · {suggestion.evidence.consecutiveCount}/
                      {suggestion.evidence.requiredCount} observations · {suggestion.ruleVersion}
                    </small>
                  </span>
                </div>
                <p>{suggestion.body}</p>
                {canDraft ? (
                  <div className="automation-suggestion-actions">
                    <button
                      className="admin-primary-button"
                      disabled={busySuggestionId === suggestion.id}
                      onClick={() => void acceptSuggestion(suggestion)}
                      type="button"
                    >
                      <Check size={15} />
                      {suggestion.kind === 'recovery'
                        ? 'Append private recovery'
                        : 'Create private draft'}
                    </button>
                    <button
                      className="admin-secondary-button"
                      disabled={busySuggestionId === suggestion.id}
                      onClick={() => void ignoreSuggestion(suggestion)}
                      type="button"
                    >
                      <X size={15} /> Ignore
                    </button>
                  </div>
                ) : (
                  <small>
                    Viewer access is read-only. No suggestion can publish automatically.
                  </small>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="editor-empty">
            <strong>No pending suggestion.</strong>
            <p>Signals must pass the configured consecutive-observation threshold first.</p>
          </div>
        )}
        <header className="mirrored-event-heading">
          <div>
            <p className="admin-eyebrow">Read-only source evidence</p>
            <h2>Mirrored events</h2>
          </div>
          <span>{mirroredEvents.length}</span>
        </header>
        {mirroredEvents.length > 0 ? (
          <div className="event-list mirrored-event-list">
            {mirroredEvents.map(event => (
              <a href={event.source.url} key={event.id} rel="noreferrer" target="_blank">
                <History size={17} />
                <span>
                  <strong>{event.title}</strong>
                  <small>
                    {event.source.id} · {event.type} · {event.presence} · v{event.version} ·
                    notification disabled
                  </small>
                </span>
                <ExternalLink size={14} />
              </a>
            ))}
          </div>
        ) : (
          <div className="editor-empty">
            <strong>No mirrored source event yet.</strong>
            <p>Successful source polls append evidence here without creating a native event.</p>
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
        <EventTemplateLibrary
          session={session}
          templates={eventTemplates}
          onCommitted={onCommitted}
        />
        {canDraft ? (
          <>
            <IncidentComposer
              session={session}
              pages={pages}
              templates={eventTemplates}
              onCommitted={onCommitted}
            />
            <SecondaryEventComposer
              session={session}
              pages={pages}
              incidents={incidents}
              templates={eventTemplates}
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
