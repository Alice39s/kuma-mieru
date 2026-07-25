import { describe, expect, test } from 'bun:test';
import type { AdminEventTemplate, AdminIncident } from './admin/api';
import {
  activeEventTemplates,
  canManageEventTemplates,
  copyEventTemplate,
  suggestedNotifySubscribers,
} from './admin/event-template-model';

const template = {
  id: 'template-1',
  name: 'API degradation',
  eventType: 'incident',
  state: 'active',
  version: 3,
  title: 'API performance degraded',
  body: 'We are investigating elevated latency.',
  affectedComponentIds: ['api'],
  defaultNotifySubscribers: true,
  noticeKind: null,
  createdBy: 'editor-1',
  createdAt: '2026-07-25T00:00:00.000Z',
  updatedAt: '2026-07-25T00:01:00.000Z',
  latestEntry: {
    sequence: 3,
    state: 'active',
    name: 'API degradation',
    title: 'API performance degraded',
    body: 'We are investigating elevated latency.',
    affectedComponentIds: ['api'],
    defaultNotifySubscribers: true,
    noticeKind: null,
    recordedAt: '2026-07-25T00:01:00.000Z',
    actorId: 'editor-1',
  },
} satisfies AdminEventTemplate;

describe('event template model', () => {
  test('excludes archived and mismatched templates from draft creation', () => {
    const archived = { ...template, id: 'template-2', state: 'archived' as const };
    const notice = {
      ...template,
      id: 'template-3',
      eventType: 'notice' as const,
      noticeKind: 'warning' as const,
    };
    expect(activeEventTemplates([template, archived, notice], 'incident')).toEqual([template]);
  });

  test('copies an immutable version into editable draft values', () => {
    const copied = copyEventTemplate(template);
    expect(copied).toEqual({
      title: template.title,
      body: template.body,
      affectedComponentIds: 'api',
      noticeKind: 'information',
      template: { id: template.id, version: 3 },
    });
    copied.title = 'Edited for this incident';
    expect(template.title).toBe('API performance degraded');
  });

  test('keeps notification as an explicit suggestion and viewers read-only', () => {
    const incident = {
      type: 'incident',
      template: {
        id: template.id,
        version: template.version,
        defaultNotifySubscribers: true,
      },
    } as AdminIncident;
    expect(suggestedNotifySubscribers(incident)).toBe(true);
    expect(canManageEventTemplates('editor')).toBe(true);
    expect(canManageEventTemplates('viewer')).toBe(false);
  });
});
