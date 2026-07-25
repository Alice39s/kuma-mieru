import { zodResolver } from '@hookform/resolvers/zod';
import { BellRing, CheckCircle2, Mail, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { requestPublicEmailSubscription } from './api';
import {
  normalizePublicSubscriptionInput,
  publicSubscriptionFormSchema,
  type PublicSubscriptionFormInput,
  type PublicSubscriptionFormValue,
} from './subscription-form';

export const PublicSubscription = ({
  pageSlug,
  services,
  incidentId,
}: {
  pageSlug: string;
  services: Array<{ id: string; name: string }>;
  incidentId?: string;
}) => {
  const [accepted, setAccepted] = useState(false);
  const [requestError, setRequestError] = useState(false);
  const form = useForm<PublicSubscriptionFormInput, unknown, PublicSubscriptionFormValue>({
    resolver: zodResolver(publicSubscriptionFormSchema),
    defaultValues: { email: '', componentIds: [], website: '' },
  });

  const submit = form.handleSubmit(async input => {
    setRequestError(false);
    try {
      await requestPublicEmailSubscription(pageSlug, {
        ...normalizePublicSubscriptionInput(input),
        ...(incidentId ? { incidentId } : {}),
      });
      setAccepted(true);
      form.reset();
    } catch {
      setRequestError(true);
    }
  });

  return (
    <section
      className="mt-10 overflow-hidden rounded-[1.75rem] border border-emerald-950/10 bg-[#17211a] text-white"
      aria-labelledby="subscription-title"
    >
      <div className="grid gap-0 md:grid-cols-[0.85fr_1.15fr]">
        <div className="relative overflow-hidden border-b border-white/10 p-6 md:border-r md:border-b-0 md:p-7">
          <div className="pointer-events-none absolute -top-24 -left-24 size-56 rounded-full bg-emerald-400/15 blur-3xl" />
          <BellRing aria-hidden="true" className="relative text-emerald-300" size={23} />
          <h2 className="relative mt-5 font-serif text-3xl font-medium" id="subscription-title">
            Follow the signal
          </h2>
          <p className="relative mt-3 text-sm leading-6 text-white/60">
            {incidentId
              ? 'Receive only later publications attached to this incident.'
              : 'Receive only explicitly published updates. Monitor changes and mirrored events never trigger secondary email by themselves.'}
          </p>
          <span className="relative mt-6 inline-flex items-center gap-2 text-xs text-white/45">
            <ShieldCheck aria-hidden="true" size={14} /> Double opt-in · one-click unsubscribe
          </span>
        </div>
        <div className="p-6 md:p-7">
          {accepted ? (
            <div className="flex min-h-48 flex-col justify-center" role="status">
              <CheckCircle2 aria-hidden="true" className="text-emerald-300" size={28} />
              <h3 className="mt-4 text-lg font-semibold">Check your inbox</h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-white/60">
                If this address can be subscribed, a confirmation email will arrive shortly. The
                response is intentionally identical for new and existing addresses.
              </p>
              <button
                className="mt-5 w-fit text-xs font-semibold text-emerald-300 hover:text-emerald-200"
                onClick={() => setAccepted(false)}
                type="button"
              >
                Subscribe another address
              </button>
            </div>
          ) : (
            <form className="space-y-5" onSubmit={submit}>
              <div>
                <label className="text-xs font-semibold text-white/70" htmlFor="subscriber-email">
                  Email address
                </label>
                <div className="mt-2 flex items-center rounded-2xl border border-white/15 bg-white/[0.07] px-4 focus-within:border-emerald-300/70">
                  <Mail aria-hidden="true" className="shrink-0 text-white/35" size={16} />
                  <input
                    autoComplete="email"
                    className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm text-white outline-none placeholder:text-white/30"
                    id="subscriber-email"
                    placeholder="you@example.com"
                    type="email"
                    {...form.register('email')}
                  />
                </div>
                {form.formState.errors.email ? (
                  <p className="mt-2 text-xs text-rose-300">
                    {form.formState.errors.email.message}
                  </p>
                ) : null}
              </div>
              <div aria-hidden="true" className="absolute -left-[10000px] size-px overflow-hidden">
                <label htmlFor="subscriber-website">Website</label>
                <input
                  autoComplete="off"
                  id="subscriber-website"
                  tabIndex={-1}
                  {...form.register('website')}
                />
              </div>
              {!incidentId && services.length > 0 ? (
                <fieldset>
                  <legend className="text-xs font-semibold text-white/70">
                    Optional component filter
                  </legend>
                  <p className="mt-1 text-xs leading-5 text-white/40">
                    Leave every component clear to receive page-wide published updates.
                  </p>
                  <div className="mt-3 flex max-h-32 flex-wrap gap-2 overflow-y-auto">
                    {services.map(service => (
                      <label
                        className="cursor-pointer rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/60 transition has-checked:border-emerald-300/60 has-checked:bg-emerald-300/10 has-checked:text-emerald-200"
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
                </fieldset>
              ) : null}
              {requestError ? (
                <p className="text-xs leading-5 text-rose-300" role="alert">
                  Email subscriptions are temporarily unavailable. RSS and Atom remain available.
                </p>
              ) : null}
              <button
                className="inline-flex items-center justify-center rounded-xl bg-emerald-300 px-4 py-2.5 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-200 disabled:cursor-wait disabled:opacity-60"
                disabled={form.formState.isSubmitting}
                type="submit"
              >
                {form.formState.isSubmitting ? 'Requesting…' : 'Send confirmation'}
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
};
