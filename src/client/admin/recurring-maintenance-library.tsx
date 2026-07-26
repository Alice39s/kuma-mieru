import { zodResolver } from '@hookform/resolvers/zod';
import { Archive, CalendarRange, Pause, Play, Plus, RefreshCw, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import {
  createRecurringMaintenancePlan,
  materializeRecurringMaintenancePlan,
  updateRecurringMaintenancePlan,
  type AdminPage,
  type AdminRecurringMaintenancePlan,
  type AdminSession,
  type RecurringMaintenancePlanState,
} from './api';
import { recurringMaintenanceDraftSchema, type RecurringMaintenanceDraftInput } from './schemas';

const componentIds = (input: string) =>
  input
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);

const weekdays = (input: string) =>
  input
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .map(Number);

const utcInput = (value: string | null) => value?.slice(0, 16) ?? '';
const utcIso = (value: string) => new Date(`${value}:00.000Z`).toISOString();

const defaultAnchor = () => {
  const value = new Date(Date.now() + 24 * 60 * 60_000);
  value.setUTCHours(1, 0, 0, 0);
  return utcInput(value.toISOString());
};

const emptyValues = (pages: AdminPage[]): RecurringMaintenanceDraftInput => ({
  pageId: pages[0]?.id ?? '',
  name: '',
  title: '',
  body: '',
  affectedComponentIds: '',
  frequency: 'weekly',
  interval: 1,
  weekdays: '1',
  anchorStartAt: defaultAnchor(),
  durationMinutes: 60,
  endsAt: '',
});

const planValues = (plan: AdminRecurringMaintenancePlan): RecurringMaintenanceDraftInput => ({
  pageId: plan.pageId,
  name: plan.name,
  title: plan.title,
  body: plan.body,
  affectedComponentIds: plan.affectedComponentIds.join(', '),
  frequency: plan.schedule.frequency,
  interval: plan.schedule.interval,
  weekdays: plan.schedule.weekdays.join(', '),
  anchorStartAt: utcInput(plan.schedule.anchorStartAt),
  durationMinutes: plan.schedule.durationMinutes,
  endsAt: utcInput(plan.schedule.endsAt),
});

const planMutation = (plan: AdminRecurringMaintenancePlan) => ({
  name: plan.name,
  title: plan.title,
  body: plan.body,
  affectedComponentIds: plan.affectedComponentIds,
  timeBasis: 'utc' as const,
  frequency: plan.schedule.frequency,
  interval: plan.schedule.interval,
  weekdays: plan.schedule.weekdays,
  anchorStartAt: plan.schedule.anchorStartAt,
  durationMinutes: plan.schedule.durationMinutes,
  endsAt: plan.schedule.endsAt,
});

export const RecurringMaintenanceLibrary = ({
  session,
  pages,
  plans,
  onCommitted,
}: {
  session: AdminSession;
  pages: AdminPage[];
  plans: AdminRecurringMaintenancePlan[];
  onCommitted: () => Promise<void>;
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(plans[0]?.id ?? null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const selected = plans.find(plan => plan.id === selectedId) ?? null;
  const canEdit = session.role !== 'viewer';
  const form = useForm<RecurringMaintenanceDraftInput>({
    resolver: zodResolver(recurringMaintenanceDraftSchema),
    defaultValues: selected ? planValues(selected) : emptyValues(pages),
  });
  const frequency = form.watch('frequency');
  const frequencyField = form.register('frequency');
  const firstValidationError = Object.values(form.formState.errors).find(
    error => typeof error?.message === 'string'
  )?.message;

  useEffect(() => {
    if (selectedId && !plans.some(plan => plan.id === selectedId)) {
      setSelectedId(plans[0]?.id ?? null);
    }
  }, [plans, selectedId]);
  useEffect(() => {
    form.reset(selected ? planValues(selected) : emptyValues(pages));
  }, [form, pages, selected?.id, selected?.updatedAt]);

  const submit = form.handleSubmit(async input => {
    const payload = {
      name: input.name.trim(),
      title: input.title.trim(),
      body: input.body.trim(),
      affectedComponentIds: componentIds(input.affectedComponentIds),
      timeBasis: 'utc' as const,
      frequency: input.frequency,
      interval: input.interval,
      weekdays: input.frequency === 'daily' ? [] : weekdays(input.weekdays),
      anchorStartAt: utcIso(input.anchorStartAt),
      durationMinutes: input.durationMinutes,
      endsAt: input.endsAt ? utcIso(input.endsAt) : null,
    };
    setBusyAction('save');
    try {
      const result = selected
        ? await updateRecurringMaintenancePlan(session, selected.id, {
            ...payload,
            expectedVersion: selected.version,
            state: selected.state,
          })
        : await createRecurringMaintenancePlan(session, {
            ...payload,
            pageId: input.pageId,
          });
      toast.success(selected ? 'Recurring plan version appended' : 'Recurring plan created', {
        description: `${result.data.materialization.materializedOccurrences} private maintenance drafts materialized.`,
      });
      setSelectedId(result.data.plan.id);
      await onCommitted();
    } catch (error) {
      toast.error('Recurring maintenance change was rejected', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusyAction(null);
    }
  });

  const transition = async (state: RecurringMaintenancePlanState) => {
    if (!selected) return;
    setBusyAction(state);
    try {
      const result = await updateRecurringMaintenancePlan(session, selected.id, {
        expectedVersion: selected.version,
        state,
        ...planMutation(selected),
      });
      toast.success(`Recurring plan ${state}`, {
        description: `${result.data.materialization.materializedOccurrences} new private drafts materialized.`,
      });
      await onCommitted();
    } catch (error) {
      toast.error('Recurring plan transition was rejected', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusyAction(null);
    }
  };

  const materialize = async () => {
    if (!selected) return;
    setBusyAction('materialize');
    try {
      const result = await materializeRecurringMaintenancePlan(session, selected);
      toast.success('Recurring horizon checked', {
        description: `${result.data.materializedOccurrences} new private drafts materialized.`,
      });
      await onCommitted();
    } catch (error) {
      toast.error('Recurring materialization failed', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <section className="workbench-editor recurring-maintenance-library">
      <header className="editor-heading">
        <div>
          <p className="admin-eyebrow">Private draft generator</p>
          <h2>Recurring maintenance</h2>
        </div>
        <CalendarRange size={22} />
      </header>
      <p className="template-boundary-copy">
        Plans use an explicit UTC cadence. Each occurrence is a separate private Maintenance draft;
        review, publication, and email remain per occurrence.
      </p>
      {plans.length > 0 ? (
        <div className="template-version-list">
          {plans.map(plan => (
            <button
              className={plan.id === selectedId ? 'is-selected' : ''}
              key={plan.id}
              onClick={() => setSelectedId(plan.id)}
              type="button"
            >
              <span>
                <strong>{plan.name}</strong>
                <small>
                  {plan.state} · v{plan.version} · {plan.schedule.frequency} ·{' '}
                  {plan.nextOccurrenceAt
                    ? `next ${new Date(plan.nextOccurrenceAt).toLocaleString()}`
                    : 'no next occurrence'}
                </small>
              </span>
              <CalendarRange size={16} />
            </button>
          ))}
        </div>
      ) : (
        <div className="editor-empty">
          <strong>No recurring plan yet.</strong>
          <p>Create one to materialize reviewable private maintenance drafts.</p>
        </div>
      )}
      {canEdit ? (
        <>
          <button
            className="admin-secondary-button template-new-button"
            onClick={() => setSelectedId(null)}
            type="button"
          >
            <Plus size={16} /> New recurring plan
          </button>
          <form className="admin-form" onSubmit={submit}>
            <div className="admin-form-row">
              <label className="admin-field">
                <span>Status page</span>
                <select disabled={Boolean(selected)} {...form.register('pageId')}>
                  {pages.map(page => (
                    <option key={page.id} value={page.id}>
                      {page.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="admin-field">
                <span>Internal plan name</span>
                <input {...form.register('name')} />
                {form.formState.errors.name ? (
                  <small>{form.formState.errors.name.message}</small>
                ) : null}
              </label>
            </div>
            <label className="admin-field">
              <span>Maintenance title</span>
              <input {...form.register('title')} />
              {form.formState.errors.title ? (
                <small>{form.formState.errors.title.message}</small>
              ) : null}
            </label>
            <label className="admin-field">
              <span>Maintenance draft copy</span>
              <textarea rows={4} {...form.register('body')} />
              {form.formState.errors.body ? (
                <small>{form.formState.errors.body.message}</small>
              ) : null}
            </label>
            <label className="admin-field">
              <span>Affected component IDs</span>
              <input {...form.register('affectedComponentIds')} />
            </label>
            <div className="admin-form-row">
              <label className="admin-field">
                <span>UTC frequency</span>
                <select
                  {...frequencyField}
                  onChange={event => {
                    void frequencyField.onChange(event);
                    form.setValue(
                      'weekdays',
                      event.target.value === 'daily' ? '' : form.getValues('weekdays') || '1',
                      { shouldDirty: true, shouldValidate: true }
                    );
                  }}
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </label>
              <label className="admin-field">
                <span>Every</span>
                <input
                  max={52}
                  min={1}
                  type="number"
                  {...form.register('interval', { valueAsNumber: true })}
                />
                {form.formState.errors.interval ? (
                  <small>{form.formState.errors.interval.message}</small>
                ) : null}
              </label>
            </div>
            {frequency === 'weekly' ? (
              <label className="admin-field">
                <span>ISO weekdays</span>
                <input placeholder="1, 3, 5" {...form.register('weekdays')} />
                <small className="admin-field-hint">
                  1 is Monday; 7 is Sunday. Values are interpreted in UTC.
                </small>
                {form.formState.errors.weekdays ? (
                  <small>{form.formState.errors.weekdays.message}</small>
                ) : null}
              </label>
            ) : null}
            <div className="admin-form-row">
              <label className="admin-field">
                <span>First UTC start</span>
                <input type="datetime-local" {...form.register('anchorStartAt')} />
                {form.formState.errors.anchorStartAt ? (
                  <small>{form.formState.errors.anchorStartAt.message}</small>
                ) : null}
              </label>
              <label className="admin-field">
                <span>Duration in minutes</span>
                <input
                  max={10_080}
                  min={1}
                  type="number"
                  {...form.register('durationMinutes', { valueAsNumber: true })}
                />
                {form.formState.errors.durationMinutes ? (
                  <small>{form.formState.errors.durationMinutes.message}</small>
                ) : null}
              </label>
            </div>
            <label className="admin-field">
              <span>Last occurrence start in UTC (optional)</span>
              <input type="datetime-local" {...form.register('endsAt')} />
              {form.formState.errors.endsAt ? (
                <small>{form.formState.errors.endsAt.message}</small>
              ) : null}
            </label>
            {firstValidationError ? (
              <p className="admin-form-error" role="alert">
                {firstValidationError}
              </p>
            ) : null}
            <div className="recurring-plan-actions">
              <button
                className="admin-primary-button"
                disabled={busyAction !== null || selected?.state === 'archived'}
                type="submit"
              >
                <Save size={16} /> {selected ? 'Append plan version' : 'Create recurring plan'}
              </button>
              {selected?.state === 'active' ? (
                <button
                  className="admin-secondary-button"
                  disabled={busyAction !== null}
                  onClick={() => void transition('paused')}
                  type="button"
                >
                  <Pause size={16} /> Pause
                </button>
              ) : null}
              {selected?.state === 'paused' ? (
                <button
                  className="admin-secondary-button"
                  disabled={busyAction !== null}
                  onClick={() => void transition('active')}
                  type="button"
                >
                  <Play size={16} /> Resume
                </button>
              ) : null}
              {selected && selected.state !== 'archived' ? (
                <button
                  className="admin-secondary-button"
                  disabled={busyAction !== null}
                  onClick={() => void transition('archived')}
                  type="button"
                >
                  <Archive size={16} /> Archive
                </button>
              ) : null}
              {selected?.state === 'active' ? (
                <button
                  className="admin-secondary-button"
                  disabled={busyAction !== null}
                  onClick={() => void materialize()}
                  type="button"
                >
                  <RefreshCw size={16} /> Check 35-day horizon
                </button>
              ) : null}
            </div>
          </form>
        </>
      ) : (
        <div className="editor-empty">
          <strong>Recurring plans are read-only.</strong>
          <p>Viewer access cannot create drafts or change a plan.</p>
        </div>
      )}
    </section>
  );
};
