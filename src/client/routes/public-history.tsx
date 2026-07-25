import { ArrowLeft, ScrollText } from 'lucide-react';
import { Link, useLoaderData, useParams, useRouteLoaderData } from 'react-router';
import type { PublicBootstrap, loadPublicHistory } from '../api';
import { PublicEventTimeline } from '../public-event-timeline';
import { PublicMirroredEvents } from '../public-mirrored-events';

export const PublicHistory = () => {
  const data = useRouteLoaderData('root') as PublicBootstrap;
  const payload = useLoaderData() as Awaited<ReturnType<typeof loadPublicHistory>>;
  const { pageSlug } = useParams();
  const page = data.pages.find(candidate => candidate.slug === pageSlug);
  if (!page || !pageSlug) return null;
  return (
    <div className="mx-auto max-w-3xl">
      <Link
        className="inline-flex items-center gap-2 text-sm text-black/60 transition hover:text-black"
        to={`/status/${encodeURIComponent(pageSlug)}/`}
      >
        <ArrowLeft aria-hidden="true" size={16} /> Return to {page.title}
      </Link>
      <header className="mt-8 rounded-[2rem] border border-black/5 bg-white p-7 shadow-[0_24px_90px_rgba(23,33,26,0.07)] sm:p-10">
        <ScrollText aria-hidden="true" className="text-emerald-800" size={25} />
        <p className="mt-6 text-xs font-semibold tracking-[0.18em] text-black/60 uppercase">
          Public evidence ledger
        </p>
        <h1 className="mt-3 font-serif text-4xl font-medium tracking-[-0.035em] sm:text-5xl">
          History
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-6 text-black/60">
          Native publications and read-only upstream observations remain visibly separate. Drafts,
          review actions and private audit details never appear here.
        </p>
      </header>
      <PublicEventTimeline pageSlug={pageSlug} publications={payload.publications} />
      <PublicMirroredEvents className="mt-12" events={payload.mirroredEvents} />
    </div>
  );
};
