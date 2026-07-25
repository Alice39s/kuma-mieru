import { ExternalLink, History } from 'lucide-react';
import type { PublicMirroredEvent } from './api';

export const PublicMirroredEvents = ({
  events,
  className = 'mt-10 border-t border-black/5 pt-8',
}: {
  events: PublicMirroredEvent[];
  className?: string;
}) => {
  if (events.length === 0) return null;
  return (
    <section className={className} aria-labelledby="mirrored-events-title">
      <div className="flex items-start justify-between gap-5">
        <div>
          <p className="text-xs font-semibold tracking-[0.18em] text-black/35 uppercase">
            Read-only source history
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-[-0.025em]" id="mirrored-events-title">
            Mirrored events
          </h2>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full bg-black/[0.04] px-3 py-1.5 text-xs font-medium text-black/55">
          <History aria-hidden="true" size={14} /> No secondary notifications
        </span>
      </div>
      <div className="mt-5 space-y-3">
        {events.map(event => (
          <article className="rounded-2xl border border-black/5 bg-[#f7f8f6] p-5" key={event.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="text-xs font-semibold tracking-[0.14em] text-black/35 uppercase">
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
                  Original source <ExternalLink aria-hidden="true" size={13} />
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
  );
};
