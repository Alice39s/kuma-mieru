import {
  BarChart3,
  BellRing,
  BookOpen,
  ChevronLeft,
  Clock3,
  History,
  Megaphone,
  RadioTower,
} from 'lucide-react';
import { Link, useLoaderData, useParams, useRouteLoaderData } from 'react-router';
import type { PublicBootstrap, StatusPagePayload } from '../api';
import { PublicEventTimeline } from '../public-event-timeline';
import { PublicMirroredEvents } from '../public-mirrored-events';
import { PublicSubscription } from '../public-subscription';
import {
  presentationForStatus,
  statusForPublicEvidence,
  type PublicStatus,
} from '../status-presentation';

export const StatusPage = () => {
  const data = useRouteLoaderData('root') as PublicBootstrap;
  const payload = useLoaderData() as StatusPagePayload;
  const snapshot = payload.snapshot;
  const { pageId, pageSlug } = useParams();
  const slug = pageSlug ?? pageId;
  const page = data.pages.find(candidate => candidate.slug === slug || candidate.id === slug);
  const sourceStatuses = snapshot?.data.map(item => item.snapshot.status) ?? ([] as PublicStatus[]);
  const staleSourceCount = snapshot?.data.filter(item => item.health.stale).length ?? 0;
  const sourceCount = snapshot?.data.length ?? 0;
  const partialCoverage = snapshot?.meta.status === 'partial';
  const freshnessWarning = staleSourceCount > 0 || partialCoverage;
  const overallStatus = statusForPublicEvidence(sourceStatuses, freshnessWarning);
  const overallPresentation = presentationForStatus(overallStatus);
  const OverallIcon = overallPresentation.Icon;
  const latestSnapshotAt = snapshot?.data
    .map(item => Date.parse(item.snapshot.fetchedAt))
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0];
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
  const publicServices = [
    ...new Map<string, { id: string; name: string }>(
      (snapshot?.data ?? [])
        .flatMap(item => item.snapshot.services)
        .map(service => [service.id, { id: service.id, name: service.name }] as const)
    ).values(),
  ].sort((left, right) => left.name.localeCompare(right.name));

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
          <p className="text-xs font-semibold tracking-[0.18em] text-black/35 uppercase">
            Public status
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
            {page.title}
          </h1>
          <p className="mt-3 text-sm leading-6 text-black/50">
            Public data is served from the local normalized snapshot. Visitor requests never call
            the upstream source directly.
          </p>
          <div
            className={`mt-8 flex flex-col gap-5 rounded-3xl border p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6 ${overallPresentation.bannerClassName}`}
            aria-live="polite"
          >
            <div className="flex items-center gap-4">
              <span
                className={`grid size-12 shrink-0 place-items-center rounded-2xl shadow-lg ${overallPresentation.iconClassName}`}
              >
                <OverallIcon aria-hidden="true" size={23} strokeWidth={2.2} />
              </span>
              <div>
                <p className="text-lg font-semibold tracking-[-0.02em]">
                  {overallPresentation.label}
                </p>
                <p className="mt-1 text-sm leading-5 text-black/55">
                  {overallPresentation.summary}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-1 text-left text-xs text-black/50 sm:text-right">
              <span className={freshnessWarning ? 'font-semibold text-amber-900' : ''}>
                {!snapshot
                  ? 'No source snapshot'
                  : staleSourceCount > 0
                    ? `${staleSourceCount} of ${sourceCount} sources stale`
                    : partialCoverage
                      ? 'Partial source coverage'
                      : `${sourceCount} ${sourceCount === 1 ? 'source' : 'sources'} current`}
              </span>
              {latestSnapshotAt ? (
                <time dateTime={new Date(latestSnapshotAt).toISOString()}>
                  Updated {new Date(latestSnapshotAt).toLocaleString()}
                </time>
              ) : (
                <span>Waiting for the first successful poll</span>
              )}
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              className="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm font-medium text-black"
              to={`/status/${encodeURIComponent(page.slug)}/history/`}
            >
              <History aria-hidden="true" size={16} /> Public history
            </Link>
            <Link
              className="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm font-medium text-black"
              to={`/status/${encodeURIComponent(page.slug)}/notices/`}
            >
              <Megaphone aria-hidden="true" size={16} /> Notices
            </Link>
            <Link
              className="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm font-medium text-black"
              to={`/status/${encodeURIComponent(page.slug)}/subscribe/`}
            >
              <BellRing aria-hidden="true" size={16} /> Subscribe
            </Link>
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
          {snapshot && snapshot.data.some(item => item.snapshot.services.length > 0) ? (
            <div className="space-y-3">
              {snapshot.data.flatMap(item =>
                item.snapshot.services.map(service => {
                  const presentation = presentationForStatus(service.status);
                  const StatusIcon = presentation.Icon;
                  return (
                    <div
                      key={service.id}
                      className="flex flex-col gap-4 rounded-2xl border border-black/[0.045] bg-[#f7f8f6] p-5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <Link
                          className="flex items-center gap-3 font-medium transition hover:text-emerald-800"
                          to={`/status/${encodeURIComponent(page.slug)}/service/${encodeURIComponent(service.id)}/`}
                        >
                          <RadioTower aria-hidden="true" size={18} /> {service.name}
                        </Link>
                        <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-black/40">
                          <span>
                            {service.latencyMs === null
                              ? 'No latency sample'
                              : `${service.latencyMs} ms latency`}
                          </span>
                          {service.uptime24h === null ? null : (
                            <span>{service.uptime24h.toFixed(2)}% uptime · 24h</span>
                          )}
                          {service.observedAt ? (
                            <time
                              className="inline-flex items-center gap-1"
                              dateTime={service.observedAt}
                            >
                              <Clock3 aria-hidden="true" size={12} />
                              {new Date(service.observedAt).toLocaleString()}
                            </time>
                          ) : null}
                        </span>
                      </div>
                      <span
                        className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${presentation.badgeClassName}`}
                        aria-label={`Status: ${presentation.label}`}
                      >
                        <StatusIcon aria-hidden="true" size={14} strokeWidth={2.3} />
                        {presentation.label}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            <div className="rounded-2xl bg-[#f5f7f4] p-5 text-sm text-black/50">
              {snapshot
                ? 'The current source snapshot does not contain any public services.'
                : 'The source poller is preparing the first local snapshot. This page will not fall back to a visitor-triggered upstream request.'}
            </div>
          )}
          <PublicEventTimeline pageSlug={page.slug} publications={payload.publications} />
          <PublicMirroredEvents events={payload.mirroredEvents} />
          {data.meta.capabilities.emailSubscriptions ? (
            <PublicSubscription pageSlug={page.slug} services={publicServices} />
          ) : null}
        </div>
      </section>
    </div>
  );
};
