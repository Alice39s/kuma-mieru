import { ArrowLeft, Clock3, DatabaseZap, RadioTower } from 'lucide-react';
import { Link, useLoaderData, useRouteLoaderData } from 'react-router';
import type { PublicBootstrap, loadPublicServiceDetail } from '../api';
import { PublicEventTimeline } from '../public-event-timeline';
import { presentationForStatus, statusForPublicEvidence } from '../status-presentation';

export const PublicServiceDetail = () => {
  const data = useRouteLoaderData('root') as PublicBootstrap;
  const payload = useLoaderData() as Awaited<ReturnType<typeof loadPublicServiceDetail>>;
  const page = data.pages.find(candidate => candidate.slug === payload.pageSlug);
  const primary = payload.matches[0];
  if (!page || !primary) return null;
  const status = statusForPublicEvidence(
    payload.matches.map(match => match.service.status),
    payload.matches.some(match => match.source.health.stale)
  );
  const presentation = presentationForStatus(status);
  const StatusIcon = presentation.Icon;

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        className="inline-flex items-center gap-2 text-sm text-black/45 transition hover:text-black"
        to={`/status/${encodeURIComponent(payload.pageSlug)}/`}
      >
        <ArrowLeft aria-hidden="true" size={16} /> Return to {page.title}
      </Link>
      <header className="mt-8 overflow-hidden rounded-[2rem] border border-black/5 bg-white shadow-[0_24px_90px_rgba(23,33,26,0.07)]">
        <div className="p-7 sm:p-10">
          <RadioTower aria-hidden="true" className="text-emerald-800" size={25} />
          <p className="mt-6 text-xs font-semibold tracking-[0.18em] text-black/35 uppercase">
            Service evidence
          </p>
          <h1 className="mt-3 font-serif text-4xl font-medium tracking-[-0.035em] sm:text-5xl">
            {primary.service.name}
          </h1>
          <div
            className={`mt-7 flex items-center gap-4 rounded-3xl border p-5 ${presentation.bannerClassName}`}
          >
            <span
              className={`grid size-11 place-items-center rounded-2xl ${presentation.iconClassName}`}
            >
              <StatusIcon aria-hidden="true" size={20} />
            </span>
            <div>
              <p className="font-semibold">{presentation.label}</p>
              <p className="mt-1 text-sm text-black/50">{presentation.summary}</p>
            </div>
          </div>
        </div>
        <div className="grid border-t border-black/5 bg-[#fafbf9] sm:grid-cols-3">
          <div className="border-b border-black/5 p-5 sm:border-r sm:border-b-0 sm:p-6">
            <span className="text-[11px] font-semibold tracking-[0.13em] text-black/35 uppercase">
              Latency
            </span>
            <strong className="mt-2 block text-lg">
              {primary.service.latencyMs === null ? 'No sample' : `${primary.service.latencyMs} ms`}
            </strong>
          </div>
          <div className="border-b border-black/5 p-5 sm:border-r sm:border-b-0 sm:p-6">
            <span className="text-[11px] font-semibold tracking-[0.13em] text-black/35 uppercase">
              Uptime · 24h
            </span>
            <strong className="mt-2 block text-lg">
              {primary.service.uptime24h === null
                ? 'Unavailable'
                : `${primary.service.uptime24h.toFixed(2)}%`}
            </strong>
          </div>
          <div className="p-5 sm:p-6">
            <span className="text-[11px] font-semibold tracking-[0.13em] text-black/35 uppercase">
              Observed
            </span>
            <strong className="mt-2 block text-sm">
              {primary.service.observedAt
                ? new Date(primary.service.observedAt).toLocaleString()
                : 'Not supplied'}
            </strong>
          </div>
        </div>
      </header>
      <section className="mt-8 rounded-3xl border border-black/5 bg-white p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <DatabaseZap aria-hidden="true" className="text-emerald-800" size={20} />
          <h2 className="text-lg font-semibold">Source evidence</h2>
        </div>
        <div className="mt-5 space-y-3">
          {payload.matches.map(match => (
            <article className="rounded-2xl bg-[#f5f7f4] p-5" key={match.source.snapshot.sourceId}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{match.source.snapshot.title}</p>
                  <p className="mt-1 text-xs text-black/40">
                    Source {match.source.snapshot.sourceId} · upstream status{' '}
                    {String(match.service.rawStatus)}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 text-xs text-black/45">
                  <Clock3 aria-hidden="true" size={13} />
                  {match.source.health.stale ? 'Stale evidence' : 'Current evidence'}
                </span>
              </div>
              <p className="mt-4 text-xs leading-5 text-black/45">
                {match.source.snapshot.capabilities.historicalDays === null
                  ? 'This source does not declare a bounded historical window.'
                  : `${match.source.snapshot.capabilities.historicalDays} days of upstream history declared.`}{' '}
                {match.source.snapshot.capabilities.latencySeries
                  ? 'Latency series is supported by the adapter.'
                  : 'No latency series is available; the page shows only the latest real sample.'}
              </p>
            </article>
          ))}
        </div>
      </section>
      {payload.publications.length > 0 ? (
        <PublicEventTimeline
          description="Only native publications that explicitly named this component appear below."
          eyebrow="Related publication"
          pageSlug={payload.pageSlug}
          publications={payload.publications}
          showFeeds={false}
          title="Service event history"
        />
      ) : null}
    </div>
  );
};
