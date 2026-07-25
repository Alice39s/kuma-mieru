import { ArrowLeft, Rss } from 'lucide-react';
import { Link, useLoaderData, useParams, useRouteLoaderData } from 'react-router';
import type { PublicBootstrap, loadPublicSubscribe } from '../api';
import { PublicSubscription } from '../public-subscription';

export const PublicSubscribe = () => {
  const data = useRouteLoaderData('root') as PublicBootstrap;
  const payload = useLoaderData() as Awaited<ReturnType<typeof loadPublicSubscribe>>;
  const { pageSlug } = useParams();
  const page = data.pages.find(candidate => candidate.slug === pageSlug);
  if (!page || !pageSlug) return null;
  const services = [
    ...new Map<string, { id: string; name: string }>(
      (payload.snapshot?.data ?? [])
        .flatMap(source => source.snapshot.services)
        .map(service => [service.id, { id: service.id, name: service.name }] as const)
    ).values(),
  ].sort((left, right) => left.name.localeCompare(right.name));
  return (
    <div className="mx-auto max-w-3xl">
      <Link
        className="inline-flex items-center gap-2 text-sm text-black/45 transition hover:text-black"
        to={`/status/${encodeURIComponent(pageSlug)}/`}
      >
        <ArrowLeft aria-hidden="true" size={16} /> Return to {page.title}
      </Link>
      <header className="mt-8 rounded-[2rem] border border-black/5 bg-white p-7 shadow-[0_24px_90px_rgba(23,33,26,0.07)] sm:p-10">
        <p className="text-xs font-semibold tracking-[0.18em] text-black/35 uppercase">
          Public subscriptions
        </p>
        <h1 className="mt-3 font-serif text-4xl font-medium tracking-[-0.035em] sm:text-5xl">
          Choose your channel
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-6 text-black/50">
          Feeds contain every public publication. Email is opt-in and only sends when a Publisher
          explicitly chooses to notify matching subscribers.
        </p>
        <div className="mt-7 flex flex-wrap gap-2">
          {(['rss', 'atom'] as const).map(format => (
            <a
              className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-xs font-semibold text-black/60"
              href={`/status/${encodeURIComponent(pageSlug)}/${format}.xml`}
              key={format}
            >
              <Rss aria-hidden="true" size={14} /> {format.toUpperCase()}
            </a>
          ))}
        </div>
      </header>
      {data.meta.capabilities.emailSubscriptions ? (
        <PublicSubscription pageSlug={pageSlug} services={services} />
      ) : (
        <section className="mt-8 rounded-3xl border border-dashed border-black/10 bg-white p-7">
          <h2 className="text-lg font-semibold">Email is not active</h2>
          <p className="mt-2 text-sm leading-6 text-black/50">
            The Owner has not activated a verified SMTP transport. RSS and Atom remain fully
            available, and this page will not collect an address while delivery is unavailable.
          </p>
        </section>
      )}
    </div>
  );
};
