import { Card, Chip } from '@heroui/react';
import { ExternalLink, History } from 'lucide-react';
import type { PublicMirroredEvent } from './api';

export const PublicMirroredEvents = ({
  events,
  className = 'mt-10 border-t border-separator pt-8',
}: {
  events: PublicMirroredEvent[];
  className?: string;
}) => {
  if (events.length === 0) return null;
  return (
    <section className={className} aria-labelledby="mirrored-events-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">
            Upstream record
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-[-0.025em]" id="mirrored-events-title">
            Mirrored events
          </h2>
        </div>
        <Chip color="default" size="sm" variant="soft">
          <History aria-hidden="true" size={13} />
          <Chip.Label>No secondary notifications</Chip.Label>
        </Chip>
      </div>
      <div className="mt-5 space-y-3">
        {events.map(event => (
          <Card className="border border-separator shadow-none" key={event.id} variant="secondary">
            <Card.Header className="flex-row items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Chip color="default" size="sm" variant="soft">
                    <Chip.Label>
                      {event.type} · {event.presence}
                    </Chip.Label>
                  </Chip>
                  <span className="text-xs text-muted">Revision {event.version}</span>
                </div>
                <Card.Title className="mt-3 text-base">{event.title}</Card.Title>
              </div>
              {event.source.url ? (
                <a
                  className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-foreground"
                  href={event.source.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  Original
                  <ExternalLink aria-hidden="true" size={13} />
                </a>
              ) : null}
            </Card.Header>
            <Card.Content className="pt-0">
              <p className="whitespace-pre-wrap text-sm leading-6 text-muted">
                {event.content || 'The source did not provide a public update body.'}
              </p>
              <p className="mt-3 text-xs leading-5 text-muted">
                {event.presence === 'absent'
                  ? `No longer advertised by the source since ${new Date(event.absentAt ?? event.updatedAt).toLocaleString()}.`
                  : `Last observed ${new Date(event.lastSeenAt).toLocaleString()} · upstream status ${event.rawStatus}`}
              </p>
            </Card.Content>
          </Card>
        ))}
      </div>
    </section>
  );
};
