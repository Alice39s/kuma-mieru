import { ArrowUpRight, Clock3, Rss } from 'lucide-react';
import { Link } from 'react-router';
import type { PublicPublication } from './api';
import {
  presentationForPublication,
  publicEventPath,
  sortPublicationsNewestFirst,
} from './public-event-presentation';

const EventTime = ({ label, value }: { label: string; value: string }) => (
  <span className="inline-flex items-center gap-1.5">
    <span>{label}</span>
    <time dateTime={value}>{new Date(value).toLocaleString()}</time>
  </span>
);

export const PublicEventTimeline = ({
  pageSlug,
  publications,
}: {
  pageSlug: string;
  publications: PublicPublication[];
}) => {
  const ordered = sortPublicationsNewestFirst(publications);
  return (
    <section className="mt-12 border-t border-black/5 pt-9" aria-labelledby="public-timeline-title">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.18em] text-black/35 uppercase">
            Published record
          </p>
          <h2
            className="mt-2 font-serif text-3xl font-medium tracking-[-0.025em]"
            id="public-timeline-title"
          >
            Event chronicle
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-black/50">
            Every card is an immutable publication. Corrections appear as a later entry rather than
            silently replacing what visitors previously saw.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3.5 py-2 text-xs font-semibold text-black/60 transition hover:border-black/20 hover:text-black"
            href={`/status/${encodeURIComponent(pageSlug)}/rss.xml`}
          >
            <Rss aria-hidden="true" size={14} /> RSS
          </a>
          <a
            className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3.5 py-2 text-xs font-semibold text-black/60 transition hover:border-black/20 hover:text-black"
            href={`/status/${encodeURIComponent(pageSlug)}/atom.xml`}
          >
            <Rss aria-hidden="true" size={14} /> Atom
          </a>
        </div>
      </div>
      {ordered.length > 0 ? (
        <ol className="relative mt-7 space-y-4 before:absolute before:top-6 before:bottom-6 before:left-[1.45rem] before:w-px before:bg-black/10">
          {ordered.map(publication => {
            const presentation = presentationForPublication(publication);
            const Icon = presentation.Icon;
            const detailPath = publicEventPath(pageSlug, publication);
            return (
              <li
                className="relative grid grid-cols-[3rem_minmax(0,1fr)] gap-4"
                id={`event-${publication.publicationId}`}
                key={publication.publicationId}
              >
                <span
                  className={`relative z-10 mt-4 grid size-12 place-items-center rounded-2xl text-white shadow-sm ${presentation.accentClassName}`}
                >
                  <Icon aria-hidden="true" size={20} />
                </span>
                <article className="rounded-3xl border border-black/[0.055] bg-[#fafbf9] p-5 sm:p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide uppercase ${presentation.badgeClassName}`}
                      >
                        {presentation.label} · {presentation.stateLabel}
                      </span>
                      <h3 className="mt-3 text-lg font-semibold tracking-[-0.02em]">
                        {publication.title}
                      </h3>
                    </div>
                    <span className="shrink-0 text-xs text-black/35">
                      Publication #{publication.eventSequence}
                    </span>
                  </div>
                  <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-black/60">
                    {publication.body}
                  </p>
                  {publication.type === 'maintenance' ? (
                    <p className="mt-4 rounded-2xl bg-sky-50 px-4 py-3 text-xs leading-5 text-sky-950">
                      Window {new Date(publication.scheduledStartAt).toLocaleString()} —{' '}
                      {new Date(publication.scheduledEndAt).toLocaleString()}
                    </p>
                  ) : null}
                  <div className="mt-5 flex flex-col gap-2 border-t border-black/5 pt-4 text-xs text-black/40 sm:flex-row sm:flex-wrap sm:gap-x-5">
                    <EventTime label="Occurred" value={publication.occurredAt} />
                    <EventTime label="Published" value={publication.publishedAt} />
                    {publication.affectedComponentIds.length > 0 ? (
                      <span>{publication.affectedComponentIds.length} affected components</span>
                    ) : (
                      <span>Page-wide update</span>
                    )}
                  </div>
                  {publication.type === 'incident' || publication.type === 'maintenance' ? (
                    <Link
                      className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-emerald-800 transition hover:text-emerald-950"
                      to={detailPath}
                    >
                      View complete timeline <ArrowUpRight aria-hidden="true" size={15} />
                    </Link>
                  ) : null}
                </article>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="mt-7 rounded-3xl border border-dashed border-black/10 bg-[#fafbf9] px-6 py-8">
          <Clock3 aria-hidden="true" className="text-black/30" size={20} />
          <p className="mt-3 text-sm font-medium">No native events have been published.</p>
          <p className="mt-1 text-xs leading-5 text-black/45">
            Live monitor evidence remains visible above. Drafts and admin activity never appear
            here.
          </p>
        </div>
      )}
    </section>
  );
};
