import { CheckCircle2, ChevronLeft, RadioTower } from 'lucide-react';
import { Link, useParams, useRouteLoaderData } from 'react-router';
import type { PublicBootstrap } from '../api';

export const StatusPage = () => {
  const data = useRouteLoaderData('root') as PublicBootstrap;
  const { pageId, pageSlug } = useParams();
  const slug = pageSlug ?? pageId;
  const page = data.pages.find(candidate => candidate.slug === slug || candidate.id === slug);

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
            <CheckCircle2 size={18} /> All systems operational
          </div>
          <h1 className="mt-7 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
            {page.title}
          </h1>
          <p className="mt-3 text-sm leading-6 text-black/50">
            Public surface is connected. Live monitor normalization arrives in the next adapter
            slice.
          </p>
        </div>
        <div className="p-7 sm:p-10">
          <div className="flex items-center justify-between rounded-2xl bg-[#f5f7f4] p-5">
            <span className="flex items-center gap-3 font-medium">
              <RadioTower size={18} /> Uptime Kuma source
            </span>
            <span className="rounded-full bg-emerald-700/10 px-3 py-1 text-xs font-semibold text-emerald-800">
              Connected
            </span>
          </div>
        </div>
      </section>
    </div>
  );
};
