import { afterEach, describe, expect, test } from 'bun:test';
import { loadStatusPage } from './api';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('public status loader', () => {
  test('keeps a usable snapshot when the event ledger is temporarily unavailable', async () => {
    globalThis.fetch = async input => {
      const path = new URL(String(input), 'http://kuma.test').pathname;
      if (path.endsWith('/snapshot')) {
        return jsonResponse({ data: [], meta: { status: 'ok' } });
      }
      if (path.endsWith('/events')) {
        return jsonResponse({ code: 'TEMPORARY_FAILURE' }, 503);
      }
      if (path.endsWith('/mirrored-events')) {
        return jsonResponse({ data: [] });
      }
      return jsonResponse({ code: 'NOT_FOUND' }, 404);
    };

    const result = await loadStatusPage({ params: { pageSlug: 'main' } });

    expect(result.snapshot).toEqual({ data: [], meta: { status: 'ok' } });
    expect(result.publications).toEqual([]);
    expect(result.mirroredEvents).toEqual([]);
    expect(result.issues).toEqual([
      {
        resource: 'events',
        message: 'The public events resource is temporarily unavailable.',
      },
    ]);
  });

  test('keeps the publication record when the live snapshot is unavailable', async () => {
    globalThis.fetch = async input => {
      const path = new URL(String(input), 'http://kuma.test').pathname;
      if (path.endsWith('/snapshot')) {
        return jsonResponse({ code: 'SOURCE_FAILED' }, 500);
      }
      if (path.endsWith('/events')) {
        return jsonResponse({
          data: [
            {
              publicationId: 'publication-1',
              eventId: 'incident-1',
              eventSequence: 1,
              pageId: 'page-main',
              title: 'Historical incident',
              body: 'The publication remains readable.',
              affectedComponentIds: [],
              occurredAt: '2026-07-27T00:00:00.000Z',
              recordedAt: '2026-07-27T00:01:00.000Z',
              publishedAt: '2026-07-27T00:02:00.000Z',
              type: 'incident',
              state: 'resolved',
            },
          ],
        });
      }
      if (path.endsWith('/mirrored-events')) {
        return jsonResponse({ data: [] });
      }
      return jsonResponse({ code: 'NOT_FOUND' }, 404);
    };

    const result = await loadStatusPage({ params: { pageSlug: 'main' } });

    expect(result.snapshot).toBeNull();
    expect(result.publications).toHaveLength(1);
    expect(result.publications[0]?.title).toBe('Historical incident');
    expect(result.issues.map(issue => issue.resource)).toEqual(['snapshot']);
  });
});
