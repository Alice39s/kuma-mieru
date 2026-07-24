import { BarChart3, BookOpen, CheckCircle2, ChevronLeft, RadioTower } from 'lucide-react';
import { Link, useLoaderData, useParams, useRouteLoaderData } from 'react-router';
import type { PublicBootstrap, SourceSnapshotState } from '../api';

export const StatusPage = () => {
  const data = useRouteLoaderData('root') as PublicBootstrap;
  const payload = useLoaderData() as {
    data: SourceSnapshotState[];
    meta: { status: 'ok' | 'partial' };
  } | null;
  const { pageId, pageSlug } = useParams();
  const slug = pageSlug ?? pageId;
  const page = data.pages.find(candidate => candidate.slug === slug || candidate.id === slug);
  const hasNativeMetrics =
    payload?.data.some(item => item.snapshot.capabilities.nativeMetrics) ?? false;
  const hasMethodology =
    payload?.data.some(item => {
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
            {payload
              ? payload.meta.status === 'ok'
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
          {payload ? (
            <div className="space-y-3">
              {payload.data.flatMap(item =>
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
        </div>
      </section>
    </div>
  );
};
