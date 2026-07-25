import {
  BarChart3,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ExternalLink,
  History,
  RadioTower,
} from 'lucide-react';
import { Link, useLoaderData, useParams, useRouteLoaderData } from 'react-router';
import type { PublicBootstrap, StatusPagePayload } from '../api';

export const StatusPage = () => {
  const data = useRouteLoaderData('root') as PublicBootstrap;
  const payload = useLoaderData() as StatusPagePayload;
  const snapshot = payload.snapshot;
  const { pageId, pageSlug } = useParams();
  const slug = pageSlug ?? pageId;
  const page = data.pages.find(candidate => candidate.slug === slug || candidate.id === slug);
  const hasNativeMetrics =
    snapshot?.data.some(item => item.snapshot.capabilities.nativeMetrics) ?? false;
  const hasMethodology =
    snapshot?.data.some(item => {
      const extension = item.snapshot.extensions['llm-mieru'];
      if (typeof extension !== 'object' || extension === null || Array.isArray(extension)) {
        return false;
      }
      const features = (extension as Record<string, unknown>).upstreamFeatures;
      return Array.isArray(features) && features.includes('methodology');
    }) ?? false;

  if (!page) {
    return (
      <section className="rounded-3xl border border-black/5 bg-white p-8">
        <h1 className="text-2xl font-semibold">Status page not found</h1>
        <Link
          className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-emerald-800"
          to="/"
        >
          <ChevronLeft size={16} /> Return to overview
        </Link>
      </section>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        className="mb-8 inline-flex items-center gap-2 text-sm text-black/45 transition hover:text-black"
        to="/"
      >
        <ChevronLeft size={16} /> All status pages
      </Link>
      <section className="overflow-hidden rounded-[2rem] border border-black/5 bg-white shadow-[0_24px_90px_rgba(23,33,26,0.07)]">
        <div className="border-b border-black/5 p-7 sm:p-10">
          <div className="flex items-center gap-3 text-sm font-semibold text-emerald-800">
            <CheckCircle2 size={18} />
            {snapshot
              ? snapshot.meta.status === 'ok'
                ? 'Live snapshot healthy'
                : 'Showing partial data'
              : 'Waiting for first snapshot'}
          </div>
          <h1 className="mt-7 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
            {page.title}
          </h1>
          <p className="mt-3 text-sm leading-6 text-black/50">
            Public data is served from the local normalized snapshot. Visitor requests never call
            the upstream source directly.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {hasNativeMetrics ? (
              <Link
                className="inline-flex items-center gap-2 rounded-xl bg-[#17211a] px-4 py-2.5 text-sm font-medium text-white"
                to={`/status/${encodeURIComponent(page.slug)}/metrics`}
              >
                <BarChart3 size={16} /> Explore native metrics
              </Link>
            ) : null}
            {hasMethodology ? (
              <Link
                className="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm font-medium text-black"
                to={`/status/${encodeURIComponent(page.slug)}/methodology`}
              >
                <BookOpen size={16} /> Measurement methodology
              </Link>
            ) : null}
          </div>
        </div>
        <div className="p-7 sm:p-10">
          {snapshot ? (
            <div className="space-y-3">
              {snapshot.data.flatMap(item =>
                item.snapshot.services.map(service => (
                  <div
                    key={service.id}
                    className="flex items-center justify-between gap-5 rounded-2xl bg-[#f5f7f4] p-5"
                  >
                    <div>
                      <span className="flex items-center gap-3 font-medium">
                        <RadioTower size={18} /> {service.name}
                      </span>
                      <span className="mt-1 block text-xs text-black/40">
                        {service.latencyMs === null
                          ? 'No latency sample'
                          : `${service.latencyMs} ms`}
                      </span>
                    </div>
                    <span className="rounded-full bg-emerald-700/10 px-3 py-1 text-xs font-semibold text-emerald-800">
                      {service.status.replaceAll('_', ' ')}
                    </span>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="rounded-2xl bg-[#f5f7f4] p-5 text-sm text-black/50">
              The source poller is preparing the first local snapshot. This page will not fall back
              to a visitor-triggered upstream request.
            </div>
          )}
          {payload.mirroredEvents.length > 0 ? (
            <section className="mt-10 border-t border-black/5 pt-8">
              <div className="flex items-start justify-between gap-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-black/35">
                    Read-only source history
                  </p>
                  <h2 className="mt-2 text-xl font-semibold tracking-[-0.025em]">
                    Mirrored events
                  </h2>
                </div>
                <span className="inline-flex items-center gap-2 rounded-full bg-black/[0.04] px-3 py-1.5 text-xs font-medium text-black/55">
                  <History size={14} /> No secondary notifications
                </span>
              </div>
              <div className="mt-5 space-y-3">
                {payload.mirroredEvents.map(event => (
                  <article
                    className="rounded-2xl border border-black/5 bg-[#f7f8f6] p-5"
                    key={event.id}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-black/35">
                          {event.type} · {event.presence} · v{event.version}
                        </span>
                        <h3 className="mt-1 font-semibold">{event.title}</h3>
                      </div>
                      {event.source.url ? (
                        <a
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-800"
                          href={event.source.url}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Original source <ExternalLink size={13} />
                        </a>
                      ) : (
                        <span className="text-xs text-black/35">
                          Source {event.source.id} · upstream ID retained
                        </span>
                      )}
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-black/55">
                      {event.content || 'The source did not provide a public update body.'}
                    </p>
                    <p className="mt-3 text-xs text-black/35">
                      {event.presence === 'absent'
                        ? `No longer advertised by the source since ${new Date(event.absentAt ?? event.updatedAt).toLocaleString()}; this is not presented as a resolved native incident.`
                        : `Last observed ${new Date(event.lastSeenAt).toLocaleString()} · upstream status ${event.rawStatus}`}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </section>
    </div>
  );
};
