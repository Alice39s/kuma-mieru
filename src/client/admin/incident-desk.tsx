import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Bell, BellOff, CheckCircle2, FilePenLine, Siren } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import {
  appendIncidentUpdate,
  createIncident,
  publishIncident,
  reviewIncidentPublication,
  type AdminIncident,
  type AdminPage,
  type AdminSession,
} from './api';
import {
  incidentDraftSchema,
  incidentUpdateDraftSchema,
  type IncidentDraftInput,
  type IncidentUpdateDraftInput,
} from './schemas';

const componentIds = (input: string) =>
  input
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);

const stateTransitions: Record<AdminIncident['state'], AdminIncident['state'][]> = {
  investigating: ['investigating', 'identified', 'monitoring', 'resolved'],
  identified: ['identified', 'monitoring', 'resolved'],
  monitoring: ['monitoring', 'resolved'],
  resolved: ['resolved'],
};

export const IncidentComposer = ({
  session,
  pages,
  onCommitted,
}: {
  session: AdminSession;
  pages: AdminPage[];
  onCommitted: () => Promise<void>;
}) => {
  const form = useForm<IncidentDraftInput>({
    resolver: zodResolver(incidentDraftSchema),
    defaultValues: {
      pageId: pages[0]?.id ?? '',
      title: '',
      body: '',
      affectedComponentIds: '',
    },
  });
  const submit = form.handleSubmit(async input => {
    try {
      const result = await createIncident(session, {
        pageId: input.pageId,
        title: input.title.trim(),
        body: input.body.trim(),
        affectedComponentIds: componentIds(input.affectedComponentIds),
      });
      toast.success(`Incident draft ${result.data.id.slice(0, 8)} created`);
      form.reset({
        pageId: pages[0]?.id ?? '',
        title: '',
        body: '',
        affectedComponentIds: '',
      });
      await onCommitted();
    } catch (error) {
      toast.error('Incident draft was not created', {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  });
  return (
    <section className="workbench-editor">
      <header className="editor-heading">
        <div>
          <p className="admin-eyebrow">Native event</p>
          <h2>Open an incident</h2>
        </div>
        <Siren size={22} />
      </header>
      {pages.length === 0 ? (
        <div className="editor-empty">
          <strong>A public page comes first.</strong>
          <p>Incidents are scoped to one committed status page.</p>
        </div>
      ) : (
        <form className="admin-form" onSubmit={submit}>
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
          <label className="admin-field">
            <span>Public title</span>
            <input placeholder="API latency elevated" {...form.register('title')} />
            {form.formState.errors.title ? (
              <small>{form.formState.errors.title.message}</small>
            ) : null}
          </label>
          <label className="admin-field">
            <span>Investigating update</span>
            <textarea rows={6} {...form.register('body')} />
            {form.formState.errors.body ? (
              <small>{form.formState.errors.body.message}</small>
            ) : null}
          </label>
          <label className="admin-field">
            <span>Affected component IDs</span>
            <input placeholder="api, inference" {...form.register('affectedComponentIds')} />
          </label>
          <button
            className="admin-primary-button"
            disabled={form.formState.isSubmitting}
            type="submit"
          >
            {form.formState.isSubmitting ? 'Creating draft…' : 'Create incident draft'}
            <ArrowRight size={17} />
          </button>
        </form>
      )}
    </section>
  );
};

export const IncidentReview = ({
  session,
  incident,
  canPublish,
  onCommitted,
}: {
  session: AdminSession;
  incident: AdminIncident;
  canPublish: boolean;
  onCommitted: () => Promise<void>;
}) => {
  const [notifySubscribers, setNotifySubscribers] = useState(false);
  const [review, setReview] = useState<
    Awaited<ReturnType<typeof reviewIncidentPublication>>['data'] | null
  >(null);
  const form = useForm<IncidentUpdateDraftInput>({
    resolver: zodResolver(incidentUpdateDraftSchema),
    defaultValues: {
      state: incident.state,
      body: '',
      affectedComponentIds: incident.latestEntry.affectedComponentIds.join(', '),
    },
  });
  useEffect(() => {
    form.reset({
      state: incident.state,
      body: '',
      affectedComponentIds: incident.latestEntry.affectedComponentIds.join(', '),
    });
    setReview(null);
  }, [form, incident]);

  const append = form.handleSubmit(async input => {
    try {
      await appendIncidentUpdate(session, incident.id, {
        expectedVersion: incident.version,
        state: input.state,
        body: input.body.trim(),
        affectedComponentIds: componentIds(input.affectedComponentIds),
      });
      toast.success('Incident update appended');
      await onCommitted();
    } catch (error) {
      toast.error('Incident update was rejected', {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  });

  const prepareReview = async () => {
    try {
      const result = await reviewIncidentPublication(session, incident.id, {
        expectedVersion: incident.version,
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
      await publishIncident(session, incident.id, {
        expectedVersion: incident.version,
        notifySubscribers,
        reviewNonce: review.reviewNonce,
      });
      toast.success(`Incident version ${incident.version} published`);
      setReview(null);
      await onCommitted();
    } catch (error) {
      toast.error('Publication was rejected', {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  return (
    <section className="incident-review">
      <header>
        <div>
          <p className="admin-eyebrow">Selected incident · v{incident.version}</p>
          <h2>{incident.title}</h2>
        </div>
        <span className={`incident-state state-${incident.state}`}>{incident.state}</span>
      </header>
      <div className="incident-current-copy">
        <strong>Latest append-only entry</strong>
        <p>{incident.latestEntry.body}</p>
      </div>
      <form className="admin-form incident-update-form" onSubmit={append}>
        <div className="admin-form-row">
          <label className="admin-field">
            <span>Next state</span>
            <select {...form.register('state')}>
              {stateTransitions[incident.state].map(state => (
                <option key={state} value={state}>
                  {state[0]?.toUpperCase()}
                  {state.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-field">
            <span>Affected component IDs</span>
            <input {...form.register('affectedComponentIds')} />
          </label>
        </div>
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
      {canPublish ? (
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
              <small>This choice is explicit for this publication only.</small>
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
                Publish v{incident.version}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="editor-empty">
          <strong>Draft access only.</strong>
          <p>An Owner or Publisher must review and publish this version.</p>
        </div>
      )}
    </section>
  );
};
