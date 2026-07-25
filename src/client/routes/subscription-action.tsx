import { zodResolver } from '@hookform/resolvers/zod';
import {
  BellRing,
  CheckCircle2,
  ChevronLeft,
  MailCheck,
  Settings2,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLoaderData } from 'react-router';
import {
  confirmPublicEmailSubscription,
  type loadSubscriptionAction,
  unsubscribePublicEmail,
  updatePublicEmailSubscription,
} from '../api';
import {
  subscriptionScopeSchema,
  type SubscriptionScopeInput,
  type SubscriptionScopeValue,
} from '../subscription-form';

const scopeSummary = (input: {
  incidentId: string | null;
  componentIds: string[];
  pageTitle: string;
}) => {
  if (input.incidentId) return `One incident on ${input.pageTitle}`;
  if (input.componentIds.length > 0) {
    return `${input.componentIds.length} selected ${input.componentIds.length === 1 ? 'component' : 'components'}`;
  }
  return `All published updates on ${input.pageTitle}`;
};

export const SubscriptionActionPage = () => {
  const data = useLoaderData() as Awaited<ReturnType<typeof loadSubscriptionAction>>;
  const [completed, setCompleted] = useState(false);
  const [requestError, setRequestError] = useState(false);
  const services = [
    ...new Map<string, { id: string; name: string }>(
      [...data.services, ...data.view.componentIds.map(id => ({ id, name: id }))].map(
        service => [service.id, service] as const
      )
    ).values(),
  ].sort((left, right) => left.name.localeCompare(right.name));
  const currentScope = data.view.incidentId
    ? 'incident'
    : data.view.componentIds.length > 0
      ? 'components'
      : 'page';
  const form = useForm<SubscriptionScopeInput, unknown, SubscriptionScopeValue>({
    resolver: zodResolver(subscriptionScopeSchema),
    defaultValues: {
      scope: currentScope,
      componentIds: data.view.componentIds,
    },
  });
  const watchedScope = form.watch('scope');
  const pageTitle = data.page?.title ?? 'this status page';
  const pagePath = data.page ? `/status/${encodeURIComponent(data.page.slug)}/` : '/';

  const runSimpleAction = async () => {
    setRequestError(false);
    try {
      if (data.purpose === 'confirm') await confirmPublicEmailSubscription(data.token);
      if (data.purpose === 'unsubscribe') await unsubscribePublicEmail(data.token);
      setCompleted(true);
    } catch {
      setRequestError(true);
    }
  };

  const saveScope = form.handleSubmit(async input => {
    setRequestError(false);
    try {
      const value = subscriptionScopeSchema.parse(input);
      await updatePublicEmailSubscription(data.token, {
        componentIds: value.scope === 'components' ? value.componentIds : [],
        incidentId: value.scope === 'incident' ? data.view.incidentId : null,
      });
      setCompleted(true);
    } catch {
      setRequestError(true);
    }
  });

  const heading =
    data.purpose === 'confirm'
      ? 'Confirm subscription'
      : data.purpose === 'manage'
        ? 'Choose what reaches you'
        : 'Unsubscribe';
  const Icon =
    data.purpose === 'confirm' ? MailCheck : data.purpose === 'manage' ? Settings2 : Trash2;

  return (
    <main className="grid min-h-screen place-items-center bg-[#f5f7f4] px-5 py-12 text-[#17211a]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(52,211,153,0.16),transparent_30%),radial-gradient(circle_at_90%_90%,rgba(15,23,42,0.08),transparent_30%)]" />
      <section className="relative w-full max-w-xl overflow-hidden rounded-[2rem] border border-black/5 bg-white shadow-[0_28px_100px_rgba(23,33,26,0.11)]">
        <header className="border-b border-black/5 p-7 sm:p-9">
          <span className="grid size-12 place-items-center rounded-2xl bg-[#17211a] text-white">
            <Icon aria-hidden="true" size={21} />
          </span>
          <p className="mt-6 text-xs font-semibold tracking-[0.18em] text-black/35 uppercase">
            Private subscription action
          </p>
          <h1 className="mt-3 font-serif text-4xl font-medium tracking-[-0.035em]">{heading}</h1>
          <p className="mt-3 text-sm leading-6 text-black/50">
            {scopeSummary({
              incidentId: data.view.incidentId,
              componentIds: data.view.componentIds,
              pageTitle,
            })}
          </p>
        </header>
        <div className="p-7 sm:p-9">
          {completed ? (
            <div role="status">
              <CheckCircle2 aria-hidden="true" className="text-emerald-700" size={29} />
              <h2 className="mt-4 text-lg font-semibold">
                {data.purpose === 'confirm'
                  ? 'Subscription confirmed'
                  : data.purpose === 'manage'
                    ? 'Preferences updated'
                    : 'You are unsubscribed'}
              </h2>
              <p className="mt-2 text-sm leading-6 text-black/50">
                The requested change has been applied. This token cannot be used to reveal an email
                address.
              </p>
              <Link
                className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#17211a] px-4 py-2.5 text-sm font-semibold text-white"
                to={pagePath}
              >
                <ChevronLeft aria-hidden="true" size={15} /> Return to status
              </Link>
            </div>
          ) : data.purpose === 'manage' ? (
            <form className="space-y-5" onSubmit={saveScope}>
              <fieldset>
                <legend className="text-sm font-semibold">Delivery scope</legend>
                <div className="mt-3 grid gap-2">
                  <label className="flex cursor-pointer gap-3 rounded-2xl border border-black/10 p-4 has-checked:border-emerald-700 has-checked:bg-emerald-50">
                    <input value="page" type="radio" {...form.register('scope')} />
                    <span>
                      <strong className="block text-sm">Entire status page</strong>
                      <span className="mt-1 block text-xs leading-5 text-black/45">
                        Every publication that explicitly opts into email.
                      </span>
                    </span>
                  </label>
                  {services.length > 0 ? (
                    <label className="flex cursor-pointer gap-3 rounded-2xl border border-black/10 p-4 has-checked:border-emerald-700 has-checked:bg-emerald-50">
                      <input value="components" type="radio" {...form.register('scope')} />
                      <span>
                        <strong className="block text-sm">Selected components</strong>
                        <span className="mt-1 block text-xs leading-5 text-black/45">
                          Only publications affecting at least one selected component.
                        </span>
                      </span>
                    </label>
                  ) : null}
                  {data.view.incidentId ? (
                    <label className="flex cursor-pointer gap-3 rounded-2xl border border-black/10 p-4 has-checked:border-emerald-700 has-checked:bg-emerald-50">
                      <input value="incident" type="radio" {...form.register('scope')} />
                      <span>
                        <strong className="block text-sm">This incident only</strong>
                        <span className="mt-1 block text-xs leading-5 text-black/45">
                          Follow later updates and its published postmortem.
                        </span>
                      </span>
                    </label>
                  ) : null}
                </div>
              </fieldset>
              {watchedScope === 'components' ? (
                <fieldset>
                  <legend className="text-sm font-semibold">Components</legend>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {services.map(service => (
                      <label
                        className="cursor-pointer rounded-full border border-black/10 px-3 py-2 text-xs text-black/55 has-checked:border-emerald-700 has-checked:bg-emerald-50 has-checked:text-emerald-950"
                        key={service.id}
                      >
                        <input
                          className="sr-only"
                          type="checkbox"
                          value={service.id}
                          {...form.register('componentIds')}
                        />
                        {service.name}
                      </label>
                    ))}
                  </div>
                  {form.formState.errors.componentIds ? (
                    <p className="mt-2 text-xs text-rose-700">
                      {form.formState.errors.componentIds.message}
                    </p>
                  ) : null}
                </fieldset>
              ) : null}
              {requestError ? (
                <p className="text-xs text-rose-700" role="alert">
                  The action could not be completed. The token may have expired or already been
                  consumed.
                </p>
              ) : null}
              <button
                className="rounded-xl bg-[#17211a] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                disabled={form.formState.isSubmitting}
                type="submit"
              >
                {form.formState.isSubmitting ? 'Saving…' : 'Save preferences'}
              </button>
            </form>
          ) : (
            <div>
              <div className="flex gap-3 rounded-2xl bg-[#f5f7f4] p-4">
                <ShieldCheck
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-emerald-700"
                  size={18}
                />
                <p className="text-xs leading-5 text-black/55">
                  Opening this page did not change anything. The action happens only when you press
                  the button below.
                </p>
              </div>
              <p className="mt-5 text-xs text-black/40">
                This action link expires {new Date(data.view.expiresAt).toLocaleString()}.
              </p>
              {requestError ? (
                <p className="mt-4 text-xs text-rose-700" role="alert">
                  The action could not be completed. The token may have expired or already been
                  consumed.
                </p>
              ) : null}
              <button
                className={`mt-6 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white ${
                  data.purpose === 'unsubscribe' ? 'bg-rose-700' : 'bg-[#17211a]'
                }`}
                onClick={runSimpleAction}
                type="button"
              >
                {data.purpose === 'confirm' ? (
                  <BellRing aria-hidden="true" size={16} />
                ) : (
                  <Trash2 aria-hidden="true" size={16} />
                )}
                {data.purpose === 'confirm' ? 'Confirm subscription' : 'Unsubscribe now'}
              </button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
};
