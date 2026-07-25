import { ArrowLeft, CalendarRange, Clock3, Layers3 } from 'lucide-react';
import { Link, useLoaderData, useParams, useRouteLoaderData } from 'react-router';
import type { PublicBootstrap, PublicPublication, loadPublicEventDetail } from '../api';
import { presentationForPublication } from '../public-event-presentation';
import { PublicSubscription } from '../public-subscription';

const TimeField = ({ label, value }: { label: string; value: string }) => (
  <div>
    <dt className="text-[11px] font-semibold tracking-[0.13em] text-black/35 uppercase">{label}</dt>
    <dd className="mt-1 text-sm text-black/60">
      <time dateTime={value}>{new Date(value).toLocaleString()}</time>
    </dd>
  </div>
);

const PublicationEntry = ({
  publication,
  anchor,
}: {
  publication: PublicPublication;
  anchor?: string;
}) => {
  const presentation = presentationForPublication(publication);
  const Icon = presentation.Icon;
  return (
    <li
      className="relative grid grid-cols-[2.75rem_minmax(0,1fr)] gap-4"
      id={anchor}
      key={publication.publicationId}
    >
      <span
        className={`relative z-10 mt-1 grid size-11 place-items-center rounded-2xl text-white ${presentation.accentClassName}`}
      >
        <Icon aria-hidden="true" size={18} />
      </span>
      <article className="rounded-3xl border border-black/5 bg-white p-5 shadow-[0_16px_50px_rgba(23,33,26,0.045)] sm:p-7">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <span
              className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase ${presentation.badgeClassName}`}
            >
              {presentation.stateLabel}
            </span>
            <h2 className="mt-3 text-xl font-semibold tracking-[-0.025em]">{publication.title}</h2>
          </div>
          <span className="text-xs text-black/35">Version {publication.eventSequence}</span>
        </div>
        <p className="mt-5 whitespace-pre-wrap text-sm leading-7 text-black/60">
          {publication.body}
        </p>
        {publication.type === 'maintenance' ? (
          <div className="mt-5 flex items-start gap-3 rounded-2xl bg-sky-50 p-4 text-sm text-sky-950">
            <CalendarRange aria-hidden="true" className="mt-0.5 shrink-0" size={17} />
            <span>
              {new Date(publication.scheduledStartAt).toLocaleString()} —{' '}
              {new Date(publication.scheduledEndAt).toLocaleString()}
            </span>
          </div>
        ) : null}
        <dl className="mt-6 grid gap-4 border-t border-black/5 pt-5 sm:grid-cols-3">
          <TimeField label="Occurred" value={publication.occurredAt} />
          <TimeField label="Recorded" value={publication.recordedAt} />
          <TimeField label="Published" value={publication.publishedAt} />
        </dl>
        <p className="mt-5 inline-flex items-center gap-2 text-xs text-black/40">
          <Layers3 aria-hidden="true" size={14} />
          {publication.affectedComponentIds.length > 0
            ? publication.affectedComponentIds.join(', ')
            : 'Page-wide update'}
        </p>
      </article>
    </li>
  );
};

export const PublicEventDetail = () => {
  const data = useRouteLoaderData('root') as PublicBootstrap;
  const payload = useLoaderData() as Awaited<ReturnType<typeof loadPublicEventDetail>>;
  const { pageSlug, eventId } = useParams();
  const page = data.pages.find(candidate => candidate.slug === pageSlug);
  const publications = [...payload.publications].sort(
    (left, right) => left.eventSequence - right.eventSequence
  );
  const latest = publications.at(-1);
  if (!page || !latest || !pageSlug) return null;
  const presentation = presentationForPublication(latest);
  const EventIcon = presentation.Icon;

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        className="inline-flex items-center gap-2 text-sm text-black/45 transition hover:text-black"
        to={`/status/${encodeURIComponent(pageSlug)}/`}
      >
        <ArrowLeft aria-hidden="true" size={16} /> Return to {page.title}
      </Link>
      <header className="mt-8 rounded-[2rem] border border-black/5 bg-white p-7 shadow-[0_24px_90px_rgba(23,33,26,0.07)] sm:p-10">
        <span
          className={`grid size-12 place-items-center rounded-2xl text-white ${presentation.accentClassName}`}
        >
          <EventIcon aria-hidden="true" size={22} />
        </span>
        <p className="mt-6 text-xs font-semibold tracking-[0.18em] text-black/35 uppercase">
          {presentation.label} · complete published record
        </p>
        <h1 className="mt-3 font-serif text-4xl font-medium tracking-[-0.035em] sm:text-5xl">
          {latest.title}
        </h1>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <span
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${presentation.badgeClassName}`}
          >
            {presentation.stateLabel}
          </span>
          <span className="inline-flex items-center gap-2 text-xs text-black/40">
            <Clock3 aria-hidden="true" size={14} /> {publications.length} published{' '}
            {publications.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>
      </header>
      <ol className="relative mt-8 space-y-5 before:absolute before:top-5 before:bottom-5 before:left-[1.35rem] before:w-px before:bg-black/10">
        {publications.map(publication => (
          <PublicationEntry publication={publication} key={publication.publicationId} />
        ))}
        {payload.postmortems.map(publication => (
          <PublicationEntry
            anchor={`postmortem-${publication.eventId}`}
            publication={publication}
            key={publication.publicationId}
          />
        ))}
      </ol>
      {payload.kind === 'incident' && data.meta.capabilities.emailSubscriptions ? (
        <PublicSubscription incidentId={eventId} pageSlug={pageSlug} services={[]} />
      ) : null}
    </div>
  );
};
