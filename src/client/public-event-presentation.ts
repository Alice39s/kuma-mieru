import { CalendarClock, CircleAlert, FileCheck2, Megaphone, type LucideIcon } from 'lucide-react';
import type { PublicPublication } from './api';

export interface PublicEventPresentation {
  label: string;
  stateLabel: string;
  Icon: LucideIcon;
  accentClassName: string;
  badgeClassName: string;
}

const stateLabels: Record<PublicPublication['state'], string> = {
  investigating: 'Investigating',
  identified: 'Identified',
  monitoring: 'Monitoring',
  resolved: 'Resolved',
  draft: 'Draft',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  published: 'Published',
  expired: 'Expired',
  withdrawn: 'Withdrawn',
  reviewed: 'Reviewed',
};

export const presentationForPublication = (
  publication: PublicPublication
): PublicEventPresentation => {
  const stateLabel = stateLabels[publication.state];
  if (publication.type === 'incident') {
    const resolved = publication.state === 'resolved';
    return {
      label: 'Incident',
      stateLabel,
      Icon: CircleAlert,
      accentClassName: resolved ? 'bg-emerald-700' : 'bg-rose-700',
      badgeClassName: resolved
        ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
        : 'border-rose-200 bg-rose-50 text-rose-900',
    };
  }
  if (publication.type === 'maintenance') {
    return {
      label: 'Maintenance',
      stateLabel,
      Icon: CalendarClock,
      accentClassName: 'bg-sky-700',
      badgeClassName: 'border-sky-200 bg-sky-50 text-sky-900',
    };
  }
  if (publication.type === 'postmortem') {
    return {
      label: 'Postmortem',
      stateLabel,
      Icon: FileCheck2,
      accentClassName: 'bg-stone-700',
      badgeClassName: 'border-stone-200 bg-stone-50 text-stone-900',
    };
  }
  return {
    label: publication.kind === 'warning' ? 'Warning notice' : 'Notice',
    stateLabel,
    Icon: Megaphone,
    accentClassName: publication.kind === 'warning' ? 'bg-amber-700' : 'bg-indigo-700',
    badgeClassName:
      publication.kind === 'warning'
        ? 'border-amber-200 bg-amber-50 text-amber-950'
        : 'border-indigo-200 bg-indigo-50 text-indigo-950',
  };
};

export const publicEventPath = (pageSlug: string, publication: PublicPublication) => {
  const page = encodeURIComponent(pageSlug);
  const event = encodeURIComponent(publication.eventId);
  if (publication.type === 'maintenance') return `/status/${page}/maintenance/${event}/`;
  if (publication.type === 'notice') return `/status/${page}/#event-${publication.publicationId}`;
  if (publication.type === 'postmortem') {
    return `/status/${page}/incidents/${encodeURIComponent(publication.incidentId)}/#postmortem-${event}`;
  }
  return `/status/${page}/incidents/${event}/`;
};

export const sortPublicationsNewestFirst = (publications: PublicPublication[]) =>
  [...publications].sort((left, right) => {
    const timeDifference = Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
    if (timeDifference !== 0) return timeDifference;
    return right.eventSequence - left.eventSequence;
  });
