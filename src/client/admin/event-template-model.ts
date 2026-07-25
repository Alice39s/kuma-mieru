import type { AdminEventTemplate, AdminNativeEvent, AdminSession, EventTemplateType } from './api';

export const canManageEventTemplates = (role: AdminSession['role']) => role !== 'viewer';

export const activeEventTemplates = (
  templates: AdminEventTemplate[],
  eventType: EventTemplateType
) => templates.filter(template => template.state === 'active' && template.eventType === eventType);

export const copyEventTemplate = (template: AdminEventTemplate) => ({
  title: template.title,
  body: template.body,
  affectedComponentIds: template.affectedComponentIds.join(', '),
  noticeKind: template.noticeKind ?? 'information',
  template: { id: template.id, version: template.version },
});

export const suggestedNotifySubscribers = (event: AdminNativeEvent) =>
  event.template?.defaultNotifySubscribers ?? false;
