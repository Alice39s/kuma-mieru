import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowRight,
  Bell,
  BellOff,
  CalendarClock,
  CheckCircle2,
  FileCheck2,
  FilePenLine,
  MessageSquareText,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import {
  appendSecondaryEventUpdate,
  createSecondaryEvent,
  publishSecondaryEvent,
  reviewSecondaryEventPublication,
  type AdminIncident,
  type AdminPage,
  type AdminSession,
  type SecondaryEvent,
} from './api';
import {
  secondaryEventDraftSchema,
  secondaryEventUpdateDraftSchema,
  type SecondaryEventDraftInput,
  type SecondaryEventUpdateDraftInput,
} from './schemas';

const componentIds = (input: string) =>
  input
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);

const localDateTime = (value: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
};

const optionalIso = (value: string) => (value ? new Date(value).toISOString() : null);

const transitions = {
  maintenance: {
    draft: ['draft', 'scheduled', 'cancelled'],
    scheduled: ['scheduled', 'in_progress', 'cancelled'],
    in_progress: ['in_progress', 'completed', 'cancelled'],
    completed: ['completed'],
    cancelled: ['cancelled'],
  },
  notice: {
    draft: ['draft', 'published', 'withdrawn'],
    published: ['published', 'expired', 'withdrawn'],
    expired: ['expired'],
    withdrawn: ['withdrawn'],
  },
  postmortem: {
    draft: ['draft', 'reviewed'],
    reviewed: ['reviewed', 'published'],
    published: ['published'],
  },
} as const;

const eventIcon = {
  maintenance: CalendarClock,
  notice: MessageSquareText,
  postmortem: FileCheck2,
};

export const SecondaryEventComposer = ({
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
  const resolvedIncidents = incidents.filter(incident => incident.state === 'resolved');
  const form = useForm<SecondaryEventDraftInput>({
    resolver: zodResolver(secondaryEventDraftSchema),
    defaultValues: {
      type: 'maintenance',
      pageId: pages[0]?.id ?? '',
      incidentId: resolvedIncidents[0]?.id ?? '',
      title: '',
      body: '',
      affectedComponentIds: '',
      scheduledStartAt: '',
      scheduledEndAt: '',
      noticeKind: 'information',
      startsAt: '',
      endsAt: '',
    },
  });
  const type = form.watch('type');
  const Icon = eventIcon[type];
  const submit = form.handleSubmit(async input => {
    const shared = { title: input.title.trim(), body: input.body.trim() };
    const payload =
      input.type === 'maintenance'
        ? {
            ...shared,
            pageId: input.pageId,
            affectedComponentIds: componentIds(input.affectedComponentIds),
            scheduledStartAt: new Date(input.scheduledStartAt).toISOString(),
            scheduledEndAt: new Date(input.scheduledEndAt).toISOString(),
          }
        : input.type === 'notice'
          ? {
              ...shared,
              pageId: input.pageId,
              kind: input.noticeKind,
              affectedComponentIds: componentIds(input.affectedComponentIds),
              startsAt: optionalIso(input.startsAt),
              endsAt: optionalIso(input.endsAt),
            }
          : { ...shared, incidentId: input.incidentId };
    try {
      await createSecondaryEvent(session, input.type, payload);
      toast.success(`${input.type} draft created`);
      form.reset({ ...form.getValues(), title: '', body: '', affectedComponentIds: '' });
      await onCommitted();
    } catch (error) {
      toast.error('Native event was not created', {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  });

  return (
    <section className="workbench-editor">
      <header className="editor-heading">
        <div>
          <p className="admin-eyebrow">Native event</p>
          <h2>Create structured activity</h2>
        </div>
        <Icon size={22} />
      </header>
      <form className="admin-form" onSubmit={submit}>
        <label className="admin-field">
          <span>Event type</span>
          <select {...form.register('type')}>
            <option value="maintenance">Maintenance</option>
            <option value="notice">Notice</option>
            <option value="postmortem">Postmortem</option>
          </select>
        </label>
        {type === 'postmortem' ? (
          <label className="admin-field">
            <span>Resolved incident</span>
            <select {...form.register('incidentId')}>
              <option value="">Choose a resolved incident</option>
              {resolvedIncidents.map(incident => (
                <option key={incident.id} value={incident.id}>
                  {incident.title}
                </option>
              ))}
            </select>
            {form.formState.errors.incidentId ? (
              <small>{form.formState.errors.incidentId.message}</small>
            ) : null}
          </label>
        ) : (
          <label className="admin-field">
            <span>Status page</span>
            <select {...form.register('pageId')}>
              {pages.map(page => (
                <option key={page.id} value={page.id}>
                  {page.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="admin-field">
          <span>Public title</span>
          <input {...form.register('title')} />
          {form.formState.errors.title ? (
            <small>{form.formState.errors.title.message}</small>
          ) : null}
        </label>
        <label className="admin-field">
          <span>Public copy</span>
          <textarea rows={5} {...form.register('body')} />
          {form.formState.errors.body ? <small>{form.formState.errors.body.message}</small> : null}
        </label>
        {type !== 'postmortem' ? (
          <label className="admin-field">
            <span>Affected component IDs</span>
            <input {...form.register('affectedComponentIds')} />
          </label>
        ) : null}
        {type === 'maintenance' ? (
          <div className="admin-form-row">
            <label className="admin-field">
              <span>Scheduled start</span>
              <input type="datetime-local" {...form.register('scheduledStartAt')} />
              {form.formState.errors.scheduledStartAt ? (
                <small>{form.formState.errors.scheduledStartAt.message}</small>
              ) : null}
            </label>
            <label className="admin-field">
              <span>Scheduled end</span>
              <input type="datetime-local" {...form.register('scheduledEndAt')} />
              {form.formState.errors.scheduledEndAt ? (
                <small>{form.formState.errors.scheduledEndAt.message}</small>
              ) : null}
            </label>
          </div>
        ) : null}
        {type === 'notice' ? (
          <>
            <label className="admin-field">
              <span>Notice kind</span>
              <select {...form.register('noticeKind')}>
                <option value="information">Information</option>
                <option value="warning">Warning</option>
              </select>
            </label>
            <div className="admin-form-row">
              <label className="admin-field">
                <span>Visible from (optional)</span>
                <input type="datetime-local" {...form.register('startsAt')} />
              </label>
              <label className="admin-field">
                <span>Visible until (optional)</span>
                <input type="datetime-local" {...form.register('endsAt')} />
                {form.formState.errors.endsAt ? (
                  <small>{form.formState.errors.endsAt.message}</small>
                ) : null}
              </label>
            </div>
          </>
        ) : null}
        <button
          className="admin-primary-button"
          disabled={form.formState.isSubmitting}
          type="submit"
        >
          Create {type} draft <ArrowRight size={17} />
        </button>
      </form>
    </section>
  );
};

export const SecondaryEventReview = ({
  session,
  event,
  canPublish,
  onCommitted,
}: {
  session: AdminSession;
  event: SecondaryEvent;
  canPublish: boolean;
  onCommitted: () => Promise<void>;
}) => {
  const [notifySubscribers, setNotifySubscribers] = useState(false);
  const [review, setReview] = useState<
    Awaited<ReturnType<typeof reviewSecondaryEventPublication>>['data'] | null
  >(null);
  const form = useForm<SecondaryEventUpdateDraftInput>({
    resolver: zodResolver(secondaryEventUpdateDraftSchema),
    defaultValues: {
      type: event.type,
      state: event.state,
      body: '',
      affectedComponentIds: event.latestEntry.affectedComponentIds.join(', '),
      scheduledStartAt: event.type === 'maintenance' ? localDateTime(event.scheduledStartAt) : '',
      scheduledEndAt: event.type === 'maintenance' ? localDateTime(event.scheduledEndAt) : '',
      noticeKind: event.type === 'notice' ? event.kind : 'information',
      startsAt: event.type === 'notice' ? localDateTime(event.startsAt) : '',
      endsAt: event.type === 'notice' ? localDateTime(event.endsAt) : '',
    },
  });
  useEffect(() => {
    form.reset({
      type: event.type,
      state: event.state,
      body: '',
      affectedComponentIds: event.latestEntry.affectedComponentIds.join(', '),
      scheduledStartAt: event.type === 'maintenance' ? localDateTime(event.scheduledStartAt) : '',
      scheduledEndAt: event.type === 'maintenance' ? localDateTime(event.scheduledEndAt) : '',
      noticeKind: event.type === 'notice' ? event.kind : 'information',
      startsAt: event.type === 'notice' ? localDateTime(event.startsAt) : '',
      endsAt: event.type === 'notice' ? localDateTime(event.endsAt) : '',
    });
    setReview(null);
  }, [event, form]);
  const allowedStates =
    event.type === 'maintenance'
      ? transitions.maintenance[event.state]
      : event.type === 'notice'
        ? transitions.notice[event.state]
        : transitions.postmortem[event.state];
  const publicationReady =
    (event.type === 'maintenance' && event.state !== 'draft') ||
    (event.type === 'notice' && event.state !== 'draft') ||
    (event.type === 'postmortem' && event.state === 'published');
  const append = form.handleSubmit(async input => {
    const shared = { expectedVersion: event.version, state: input.state, body: input.body.trim() };
    const payload =
      event.type === 'maintenance'
        ? {
            ...shared,
            affectedComponentIds: componentIds(input.affectedComponentIds),
            scheduledStartAt: new Date(input.scheduledStartAt).toISOString(),
            scheduledEndAt: new Date(input.scheduledEndAt).toISOString(),
          }
        : event.type === 'notice'
          ? {
              ...shared,
              kind: input.noticeKind,
              affectedComponentIds: componentIds(input.affectedComponentIds),
              startsAt: optionalIso(input.startsAt),
              endsAt: optionalIso(input.endsAt),
            }
          : shared;
    try {
      await appendSecondaryEventUpdate(session, event, payload);
      toast.success(`${event.type} update appended`);
      await onCommitted();
    } catch (error) {
      toast.error('Event update was rejected', {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  });
  const prepareReview = async () => {
    try {
      const result = await reviewSecondaryEventPublication(session, event, {
        expectedVersion: event.version,
        notifySubscribers,
      });
      setReview(result.data);
    } catch (error) {
      toast.error('Publication review failed', {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };
  const publish = async () => {
    if (!review) return;
    try {
      await publishSecondaryEvent(session, event, {
        expectedVersion: event.version,
        notifySubscribers,
        reviewNonce: review.reviewNonce,
      });
      toast.success(`${event.type} version ${event.version} published`);
      setReview(null);
      await onCommitted();
    } catch (error) {
      toast.error('Publication was rejected', {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };
  const Icon = eventIcon[event.type];
  return (
    <section className="incident-review">
      <header>
        <div>
          <p className="admin-eyebrow">
            Selected {event.type} · v{event.version}
          </p>
          <h2>{event.title}</h2>
        </div>
        <span className={`incident-state state-${event.state}`}>
          <Icon size={14} /> {event.state}
        </span>
      </header>
      <div className="incident-current-copy">
        <strong>Latest append-only entry</strong>
        <p>{event.latestEntry.body}</p>
      </div>
      <form className="admin-form incident-update-form" onSubmit={append}>
        <input type="hidden" {...form.register('type')} />
        <label className="admin-field">
          <span>Next state</span>
          <select {...form.register('state')}>
            {allowedStates.map(state => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
        </label>
        {event.type !== 'postmortem' ? (
          <label className="admin-field">
            <span>Affected component IDs</span>
            <input {...form.register('affectedComponentIds')} />
          </label>
        ) : null}
        {event.type === 'maintenance' ? (
          <div className="admin-form-row">
            <label className="admin-field">
              <span>Scheduled start</span>
              <input type="datetime-local" {...form.register('scheduledStartAt')} />
              {form.formState.errors.scheduledStartAt ? (
                <small>{form.formState.errors.scheduledStartAt.message}</small>
              ) : null}
            </label>
            <label className="admin-field">
              <span>Scheduled end</span>
              <input type="datetime-local" {...form.register('scheduledEndAt')} />
              {form.formState.errors.scheduledEndAt ? (
                <small>{form.formState.errors.scheduledEndAt.message}</small>
              ) : null}
            </label>
          </div>
        ) : null}
        {event.type === 'notice' ? (
          <>
            <label className="admin-field">
              <span>Notice kind</span>
              <select {...form.register('noticeKind')}>
                <option value="information">Information</option>
                <option value="warning">Warning</option>
              </select>
            </label>
            <div className="admin-form-row">
              <label className="admin-field">
                <span>Visible from</span>
                <input type="datetime-local" {...form.register('startsAt')} />
              </label>
              <label className="admin-field">
                <span>Visible until</span>
                <input type="datetime-local" {...form.register('endsAt')} />
                {form.formState.errors.endsAt ? (
                  <small>{form.formState.errors.endsAt.message}</small>
                ) : null}
              </label>
            </div>
          </>
        ) : null}
        <label className="admin-field">
          <span>New public update</span>
          <textarea rows={4} {...form.register('body')} />
          {form.formState.errors.body ? <small>{form.formState.errors.body.message}</small> : null}
        </label>
        <button
          className="admin-secondary-button"
          disabled={form.formState.isSubmitting}
          type="submit"
        >
          <FilePenLine size={16} /> Append update
        </button>
      </form>
      {canPublish && publicationReady ? (
        <div className="publication-review">
          <button
            className={`notification-choice ${notifySubscribers ? 'is-selected' : ''}`}
            onClick={() => {
              setNotifySubscribers(value => !value);
              setReview(null);
            }}
            type="button"
          >
            {notifySubscribers ? <Bell size={17} /> : <BellOff size={17} />}
            <span>
              <strong>{notifySubscribers ? 'Notify subscribers' : 'Publish without email'}</strong>
              <small>Explicit for this publication only.</small>
            </span>
          </button>
          {!review ? (
            <button className="admin-primary-button" onClick={prepareReview} type="button">
              Review publication <ArrowRight size={17} />
            </button>
          ) : (
            <div className="publication-confirmation">
              <CheckCircle2 size={18} />
              <span>
                <strong>{review.estimatedRecipients} eligible recipients</strong>
                <small>Review expires {new Date(review.expiresAt).toLocaleTimeString()}</small>
              </span>
              <button className="admin-danger-button" onClick={publish} type="button">
                Publish v{event.version}
              </button>
            </div>
          )}
        </div>
      ) : canPublish ? (
        <div className="publication-review publication-gate">
          <strong>Publication is not ready.</strong>
          <small>
            {event.type === 'postmortem'
              ? 'Move the postmortem through review to published before creating its public snapshot.'
              : `Move the ${event.type} out of draft before creating its public snapshot.`}
          </small>
        </div>
      ) : null}
    </section>
  );
};
