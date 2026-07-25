import { zodResolver } from '@hookform/resolvers/zod';
import { Archive, Bell, BellOff, LayoutTemplate, Plus, RotateCcw, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import {
  createEventTemplate,
  updateEventTemplate,
  type AdminEventTemplate,
  type AdminSession,
} from './api';
import { canManageEventTemplates } from './event-template-model';
import { eventTemplateDraftSchema, type EventTemplateDraftInput } from './schemas';

const emptyTemplate = (): EventTemplateDraftInput => ({
  name: '',
  eventType: 'incident',
  state: 'active',
  title: '',
  body: '',
  affectedComponentIds: '',
  defaultNotifySubscribers: false,
  noticeKind: 'information',
});

const editTemplate = (template: AdminEventTemplate): EventTemplateDraftInput => ({
  name: template.name,
  eventType: template.eventType,
  state: template.state,
  title: template.title,
  body: template.body,
  affectedComponentIds: template.affectedComponentIds.join(', '),
  defaultNotifySubscribers: template.defaultNotifySubscribers,
  noticeKind: template.noticeKind ?? 'information',
});

const componentIds = (input: string) => [
  ...new Set(
    input
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
  ),
];

export const EventTemplateLibrary = ({
  session,
  templates,
  onCommitted,
}: {
  session: AdminSession;
  templates: AdminEventTemplate[];
  onCommitted: () => Promise<void>;
}) => {
  const canManage = canManageEventTemplates(session.role);
  const [selectedId, setSelectedId] = useState<string>('');
  const selected = templates.find(template => template.id === selectedId) ?? null;
  const form = useForm<EventTemplateDraftInput>({
    resolver: zodResolver(eventTemplateDraftSchema),
    defaultValues: emptyTemplate(),
  });
  const eventType = form.watch('eventType');

  useEffect(() => {
    form.reset(selected ? editTemplate(selected) : emptyTemplate());
  }, [form, selected]);

  const submit = form.handleSubmit(async input => {
    const payload = {
      name: input.name,
      eventType: input.eventType,
      title: input.title,
      body: input.body,
      affectedComponentIds:
        input.eventType === 'postmortem' ? [] : componentIds(input.affectedComponentIds),
      defaultNotifySubscribers: input.defaultNotifySubscribers,
      noticeKind: input.eventType === 'notice' ? input.noticeKind : null,
    };
    try {
      if (selected) {
        await updateEventTemplate(session, selected.id, {
          ...payload,
          expectedVersion: selected.version,
          state: input.state,
        });
        toast.success(`Template version ${selected.version + 1} saved`);
      } else {
        await createEventTemplate(session, payload);
        toast.success('Active event template created');
        form.reset(emptyTemplate());
      }
      await onCommitted();
    } catch (error) {
      toast.error('Event template was not saved', {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  });

  return (
    <section className="workbench-editor event-template-library">
      <header className="editor-heading">
        <div>
          <p className="admin-eyebrow">Private drafting aid</p>
          <h2>Event templates</h2>
        </div>
        <LayoutTemplate size={22} />
      </header>
      <p className="template-boundary-copy">
        Templates copy text into a private draft. They cannot publish, and their email value remains
        a suggestion that must be chosen again during Publication Review.
      </p>
      {templates.length > 0 ? (
        <div className="template-version-list">
          {templates.map(template => (
            <button
              className={template.id === selectedId ? 'is-selected' : ''}
              key={template.id}
              onClick={() => setSelectedId(template.id)}
              type="button"
            >
              <span>
                <strong>{template.name}</strong>
                <small>
                  {template.eventType} · {template.state} · v{template.version}
                </small>
              </span>
              {template.state === 'archived' ? <Archive size={15} /> : <LayoutTemplate size={15} />}
            </button>
          ))}
        </div>
      ) : (
        <div className="editor-empty">
          <strong>No reusable event copy yet.</strong>
          <p>Create a private template without creating a public event.</p>
        </div>
      )}
      {canManage ? (
        <>
          <button
            className="admin-secondary-button template-new-button"
            onClick={() => {
              setSelectedId('');
              form.reset(emptyTemplate());
            }}
            type="button"
          >
            <Plus size={16} /> New template
          </button>
          <form className="admin-form" onSubmit={submit}>
            <div className="admin-form-row">
              <label className="admin-field">
                <span>Template name</span>
                <input {...form.register('name')} />
                {form.formState.errors.name ? (
                  <small>{form.formState.errors.name.message}</small>
                ) : null}
              </label>
              {selected ? (
                <label className="admin-field">
                  <span>Event type</span>
                  <strong className="template-immutable-value">{selected.eventType}</strong>
                  <input type="hidden" {...form.register('eventType')} />
                </label>
              ) : (
                <label className="admin-field">
                  <span>Event type</span>
                  <select {...form.register('eventType')}>
                    <option value="incident">Incident</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="notice">Notice</option>
                    <option value="postmortem">Postmortem</option>
                  </select>
                </label>
              )}
            </div>
            <label className="admin-field">
              <span>Public title default</span>
              <input {...form.register('title')} />
              {form.formState.errors.title ? (
                <small>{form.formState.errors.title.message}</small>
              ) : null}
            </label>
            <label className="admin-field">
              <span>Public copy default</span>
              <textarea rows={5} {...form.register('body')} />
              {form.formState.errors.body ? (
                <small>{form.formState.errors.body.message}</small>
              ) : null}
            </label>
            {eventType !== 'postmortem' ? (
              <label className="admin-field">
                <span>Affected component ID defaults</span>
                <input placeholder="api, inference" {...form.register('affectedComponentIds')} />
              </label>
            ) : null}
            {eventType === 'notice' ? (
              <label className="admin-field">
                <span>Notice kind default</span>
                <select {...form.register('noticeKind')}>
                  <option value="information">Information</option>
                  <option value="warning">Warning</option>
                </select>
              </label>
            ) : null}
            <button
              className={`notification-choice ${
                form.watch('defaultNotifySubscribers') ? 'is-selected' : ''
              }`}
              onClick={() =>
                form.setValue(
                  'defaultNotifySubscribers',
                  !form.getValues('defaultNotifySubscribers'),
                  { shouldDirty: true }
                )
              }
              type="button"
            >
              {form.watch('defaultNotifySubscribers') ? <Bell size={17} /> : <BellOff size={17} />}
              <span>
                <strong>
                  {form.watch('defaultNotifySubscribers')
                    ? 'Suggest notifying subscribers'
                    : 'Suggest publishing without email'}
                </strong>
                <small>Suggestion only; Publish still requires an explicit Boolean.</small>
              </span>
            </button>
            {selected ? (
              <label className="admin-field">
                <span>Lifecycle</span>
                <select {...form.register('state')}>
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                </select>
              </label>
            ) : (
              <input type="hidden" {...form.register('state')} />
            )}
            <button
              className="admin-primary-button"
              disabled={form.formState.isSubmitting}
              type="submit"
            >
              {selected ? (
                selected.state === 'archived' && form.watch('state') === 'active' ? (
                  <>
                    <RotateCcw size={16} /> Restore as a new version
                  </>
                ) : (
                  <>
                    <Save size={16} /> Append template version
                  </>
                )
              ) : (
                <>
                  <Plus size={16} /> Create active template
                </>
              )}
            </button>
          </form>
        </>
      ) : (
        <div className="editor-empty">
          <strong>Template library is read-only.</strong>
          <p>The Viewer role cannot create, change, archive, or restore drafting defaults.</p>
        </div>
      )}
    </section>
  );
};
