import { ArrowLeft, Megaphone } from 'lucide-react';
import { Link, useLoaderData, useParams, useRouteLoaderData } from 'react-router';
import type { PublicBootstrap, loadPublicNotices } from '../api';
import { PublicEventTimeline } from '../public-event-timeline';

export const PublicNotices = () => {
  const data = useRouteLoaderData('root') as PublicBootstrap;
  const payload = useLoaderData() as Awaited<ReturnType<typeof loadPublicNotices>>;
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
        <Megaphone aria-hidden="true" className="text-indigo-700" size={25} />
        <p className="mt-6 text-xs font-semibold tracking-[0.18em] text-black/60 uppercase">
          General communication
        </p>
        <h1 className="mt-3 font-serif text-4xl font-medium tracking-[-0.035em] sm:text-5xl">
          Notices
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-6 text-black/60">
          Notices communicate information or warnings without pretending that a monitor failed or
          changing component health.
        </p>
      </header>
      <PublicEventTimeline
        description="Only explicitly published general notices appear here. Withdrawals and corrections remain later immutable publications."
        emptyDescription="Draft notices and private review activity never appear on the public page."
        emptyTitle="No notices have been published."
        eyebrow="Notice ledger"
        pageSlug={pageSlug}
        publications={payload.publications}
        showFeeds={false}
        title="Published notices"
      />
    </div>
  );
};
