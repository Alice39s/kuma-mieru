import { Card, Chip } from '@heroui/react';
import { buttonVariants } from '@heroui/styles';
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
    <time className="font-medium text-foreground" dateTime={value}>
      {new Date(value).toLocaleString()}
    </time>
  </span>
);

const chipColorForPublication = (
  publication: PublicPublication
): 'accent' | 'danger' | 'default' | 'success' | 'warning' => {
  if (publication.type === 'incident') {
    return publication.state === 'resolved' ? 'success' : 'danger';
  }
  if (publication.type === 'maintenance') {
    return publication.state === 'completed' ? 'success' : 'warning';
  }
  if (publication.type === 'notice') return publication.kind === 'warning' ? 'warning' : 'accent';
  return 'default';
};

export const PublicEventTimeline = ({
  pageSlug,
  publications,
  eyebrow = 'Published record',
  title = 'Event history',
  description = 'Published incidents, maintenance, notices, and postmortems.',
  showFeeds = true,
  emptyTitle = 'No public events have been published.',
  emptyDescription = 'Live monitor evidence remains visible above.',
}: {
  pageSlug: string;
  publications: PublicPublication[];
  eyebrow?: string;
  title?: string;
  description?: string;
  showFeeds?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}) => {
  const ordered = sortPublicationsNewestFirst(publications);
  return (
    <section aria-labelledby="public-timeline-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">{eyebrow}</p>
          <h2
            className="mt-2 text-xl font-semibold tracking-[-0.025em] text-foreground"
            id="public-timeline-title"
          >
            {title}
          </h2>
          <p className="mt-1.5 max-w-xl text-sm leading-6 text-muted">{description}</p>
        </div>
        {showFeeds ? (
          <div className="flex flex-wrap gap-2">
            <a
              className={buttonVariants({ size: 'sm', variant: 'outline', className: 'gap-2' })}
              href={`/status/${encodeURIComponent(pageSlug)}/rss.xml`}
            >
              <Rss aria-hidden="true" size={14} />
              RSS
            </a>
            <a
              className={buttonVariants({ size: 'sm', variant: 'outline', className: 'gap-2' })}
              href={`/status/${encodeURIComponent(pageSlug)}/atom.xml`}
            >
              <Rss aria-hidden="true" size={14} />
              Atom
            </a>
          </div>
        ) : null}
      </div>
      {ordered.length > 0 ? (
        <ol className="mt-6 space-y-3">
          {ordered.map(publication => {
            const presentation = presentationForPublication(publication);
            const detailPath = publicEventPath(pageSlug, publication);
            return (
              <li id={`event-${publication.publicationId}`} key={publication.publicationId}>
                <Card className="border border-separator shadow-none">
                  <Card.Header className="flex-row items-start justify-between gap-4 pb-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip color={chipColorForPublication(publication)} size="sm" variant="soft">
                          <Chip.Label>
                            {presentation.label} · {presentation.stateLabel}
                          </Chip.Label>
                        </Chip>
                        <span className="text-xs text-muted">
                          Publication #{publication.eventSequence}
                        </span>
                      </div>
                      <Card.Title className="mt-3">{publication.title}</Card.Title>
                    </div>
                  </Card.Header>
                  <Card.Content className="pt-0">
                    <p className="whitespace-pre-wrap text-sm leading-6 text-muted">
                      {publication.body}
                    </p>
                    {publication.type === 'maintenance' ? (
                      <p className="mt-4 rounded-lg bg-warning-soft px-3 py-2 text-xs leading-5 text-warning-soft-foreground">
                        Window {new Date(publication.scheduledStartAt).toLocaleString()} —{' '}
                        {new Date(publication.scheduledEndAt).toLocaleString()}
                      </p>
                    ) : null}
                  </Card.Content>
                  <Card.Footer className="flex-col items-start justify-between gap-3 border-t border-separator pt-4 text-xs text-muted sm:flex-row sm:items-center">
                    <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:gap-x-5">
                      <EventTime label="Occurred" value={publication.occurredAt} />
                      <EventTime label="Published" value={publication.publishedAt} />
                      <span>
                        {publication.affectedComponentIds.length > 0
                          ? `${publication.affectedComponentIds.length} affected components`
                          : 'Page-wide update'}
                      </span>
                    </div>
                    {publication.type === 'incident' || publication.type === 'maintenance' ? (
                      <Link
                        className="inline-flex shrink-0 items-center gap-1.5 font-semibold text-foreground"
                        to={detailPath}
                      >
                        Full timeline
                        <ArrowUpRight aria-hidden="true" size={14} />
                      </Link>
                    ) : null}
                  </Card.Footer>
                </Card>
              </li>
            );
          })}
        </ol>
      ) : (
        <Card
          className="mt-6 border border-dashed border-separator shadow-none"
          variant="secondary"
        >
          <Card.Header>
            <Clock3 aria-hidden="true" className="mb-2 text-muted" size={19} />
            <Card.Title className="text-base">{emptyTitle}</Card.Title>
            <Card.Description>{emptyDescription}</Card.Description>
          </Card.Header>
        </Card>
      )}
    </section>
  );
};
