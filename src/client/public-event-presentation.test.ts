import { describe, expect, test } from 'bun:test';
import type { PublicPublication } from './api';
import {
  presentationForPublication,
  publicEventPath,
  sortPublicationsNewestFirst,
} from './public-event-presentation';

const incident: PublicPublication = {
  publicationId: 'publication-incident',
  eventId: 'incident-1',
  eventSequence: 2,
  type: 'incident',
  pageId: 'public',
  title: 'API latency',
  state: 'monitoring',
  body: 'A fix has been deployed.',
  affectedComponentIds: ['api'],
  occurredAt: '2026-07-25T01:00:00.000Z',
  recordedAt: '2026-07-25T01:01:00.000Z',
  publishedAt: '2026-07-25T01:02:00.000Z',
};

test('maps every public event type to explicit text and a stable detail path', () => {
  const publications: PublicPublication[] = [
    incident,
    {
      ...incident,
      publicationId: 'publication-maintenance',
      eventId: 'maintenance-1',
      type: 'maintenance',
      state: 'scheduled',
      scheduledStartAt: '2026-07-26T01:00:00.000Z',
      scheduledEndAt: '2026-07-26T02:00:00.000Z',
    },
    {
      ...incident,
      publicationId: 'publication-notice',
      eventId: 'notice-1',
      type: 'notice',
      state: 'published',
      kind: 'warning',
      startsAt: null,
      endsAt: null,
    },
    {
      ...incident,
      publicationId: 'publication-postmortem',
      eventId: 'postmortem-1',
      type: 'postmortem',
      state: 'published',
      incidentId: 'incident-1',
    },
  ];

  expect(publications.map(publication => presentationForPublication(publication).label)).toEqual([
    'Incident',
    'Maintenance',
    'Warning notice',
    'Postmortem',
  ]);
  expect(publications.map(publication => publicEventPath('main', publication))).toEqual([
    '/status/main/incidents/incident-1/',
    '/status/main/maintenance/maintenance-1/',
    '/status/main/#event-publication-notice',
    '/status/main/incidents/incident-1/#postmortem-postmortem-1',
  ]);
});

describe('public event chronology', () => {
  test('orders by publication time and then event sequence without mutating input', () => {
    const older = { ...incident, publicationId: 'older', eventSequence: 9 };
    const newerSequence = {
      ...incident,
      publicationId: 'newer-sequence',
      eventSequence: 3,
      publishedAt: '2026-07-25T02:00:00.000Z',
    };
    const olderSequence = {
      ...newerSequence,
      publicationId: 'older-sequence',
      eventSequence: 2,
    };
    const input = [older, olderSequence, newerSequence];
    expect(sortPublicationsNewestFirst(input).map(item => item.publicationId)).toEqual([
      'newer-sequence',
      'older-sequence',
      'older',
    ]);
    expect(input.map(item => item.publicationId)).toEqual([
      'older',
      'older-sequence',
      'newer-sequence',
    ]);
  });
});
