import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { openDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrator.js';
import { createIncident } from './repository.js';
import {
  appendEventTemplateUpdate,
  createEventTemplate,
  listEventTemplates,
} from './template-repository.js';

const audit = {
  actorId: 'editor-1',
  requestId: 'event-template-test',
  userAgent: 'event-template-fixture',
};

const incidentTemplateInput = {
  name: 'Investigating API degradation',
  eventType: 'incident' as const,
  title: 'API performance degraded',
  body: 'We are investigating elevated API latency.',
  affectedComponentIds: ['api'],
  defaultNotifySubscribers: true,
  noticeKind: null,
};

test('keeps event templates append-only and applies only an explicit active version', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-event-template-'));
  const databasePath = resolve(directory, 'event-template.sqlite3');
  const { database } = openDatabase(databasePath);
  try {
    await migrateDatabase(database, {
      directory: resolve(process.cwd(), 'migrations'),
      databasePath,
    });

    const created = createEventTemplate(
      database,
      incidentTemplateInput,
      'event-template-create-0001',
      audit
    );
    assert.equal(created.version, 1);
    assert.equal(created.state, 'active');
    assert.equal(created.latestEntry.actorId, audit.actorId);
    assert.equal(created.defaultNotifySubscribers, true);
    assert.equal(
      createEventTemplate(database, incidentTemplateInput, 'event-template-create-0001', audit).id,
      created.id
    );
    assert.throws(
      () =>
        createEventTemplate(
          database,
          { ...incidentTemplateInput, body: 'A different command.' },
          'event-template-create-0001',
          audit
        ),
      error => {
        assert.equal((error as { code: string }).code, 'idempotency_key_reused');
        return true;
      }
    );
    assert.throws(
      () =>
        createEventTemplate(
          database,
          { ...incidentTemplateInput, name: incidentTemplateInput.name.toUpperCase() },
          'event-template-create-0002',
          audit
        ),
      error => {
        assert.equal((error as { code: string }).code, 'event_template_name_conflict');
        return true;
      }
    );

    const incident = createIncident(
      database,
      {
        pageId: 'public',
        title: 'Edited title for this incident',
        body: 'Operators can edit copied template content before saving.',
        state: 'investigating',
        affectedComponentIds: ['api', 'inference'],
        template: { id: created.id, version: created.version },
      },
      'incident-from-template-0001',
      audit
    );
    assert.deepEqual(incident.template, {
      id: created.id,
      version: 1,
      defaultNotifySubscribers: true,
    });

    const revised = appendEventTemplateUpdate(
      database,
      created.id,
      {
        expectedVersion: created.version,
        state: 'active',
        ...incidentTemplateInput,
        body: 'A revised future default.',
        defaultNotifySubscribers: false,
      },
      audit
    );
    assert.equal(revised.version, 2);
    assert.equal(
      incident.latestEntry.body,
      'Operators can edit copied template content before saving.'
    );
    assert.deepEqual(incident.template, {
      id: created.id,
      version: 1,
      defaultNotifySubscribers: true,
    });
    assert.throws(
      () =>
        appendEventTemplateUpdate(
          database,
          created.id,
          {
            expectedVersion: 1,
            state: 'archived',
            ...incidentTemplateInput,
          },
          audit
        ),
      error => {
        assert.equal((error as { code: string }).code, 'event_template_version_conflict');
        return true;
      }
    );
    assert.throws(
      () =>
        createIncident(
          database,
          {
            pageId: 'public',
            title: 'Stale template reference',
            body: 'This command must fail closed.',
            state: 'investigating',
            affectedComponentIds: [],
            template: { id: created.id, version: 1 },
          },
          'incident-from-template-stale',
          audit
        ),
      error => {
        assert.equal((error as { code: string }).code, 'event_template_version_conflict');
        return true;
      }
    );

    const archived = appendEventTemplateUpdate(
      database,
      created.id,
      {
        expectedVersion: revised.version,
        state: 'archived',
        ...incidentTemplateInput,
        body: revised.body,
        defaultNotifySubscribers: revised.defaultNotifySubscribers,
      },
      audit
    );
    assert.equal(archived.version, 3);
    assert.equal(archived.state, 'archived');
    assert.throws(
      () =>
        createIncident(
          database,
          {
            pageId: 'public',
            title: 'Archived template reference',
            body: 'This command must fail closed.',
            state: 'investigating',
            affectedComponentIds: [],
            template: { id: archived.id, version: archived.version },
          },
          'incident-from-template-archived',
          audit
        ),
      error => {
        assert.equal((error as { code: string }).code, 'event_template_archived');
        return true;
      }
    );

    const noticeTemplate = createEventTemplate(
      database,
      {
        name: 'General warning',
        eventType: 'notice',
        title: 'Service information',
        body: 'A general service warning.',
        affectedComponentIds: [],
        defaultNotifySubscribers: false,
        noticeKind: 'warning',
      },
      'event-template-create-notice',
      audit
    );
    assert.throws(
      () =>
        createIncident(
          database,
          {
            pageId: 'public',
            title: 'Wrong template type',
            body: 'This command must fail closed.',
            state: 'investigating',
            affectedComponentIds: [],
            template: { id: noticeTemplate.id, version: noticeTemplate.version },
          },
          'incident-from-notice-template',
          audit
        ),
      error => {
        assert.equal((error as { code: string }).code, 'event_template_type_conflict');
        return true;
      }
    );

    assert.deepEqual(
      listEventTemplates(database, 'active').map(template => template.id),
      [noticeTemplate.id]
    );
    assert.deepEqual(
      listEventTemplates(database, 'archived').map(template => template.id),
      [archived.id]
    );
    assert.equal(
      (
        database
          .prepare(
            `SELECT COUNT(*) AS count FROM event_template_entries
             WHERE template_id = ?`
          )
          .get(created.id) as { count: number }
      ).count,
      3
    );
    assert.equal(
      (
        database.prepare('SELECT COUNT(*) AS count FROM event_publications').get() as {
          count: number;
        }
      ).count,
      0
    );
    assert.equal(
      (
        database.prepare('SELECT COUNT(*) AS count FROM notification_outbox').get() as {
          count: number;
        }
      ).count,
      0
    );
    const auditJson = database
      .prepare(
        `SELECT after_json FROM admin_audit
         WHERE target_type = 'event_template' ORDER BY occurred_at`
      )
      .all()
      .map(row => (row as { after_json: string }).after_json)
      .join('\n');
    assert.equal(auditJson.includes(incidentTemplateInput.body), false);
    assert.equal(auditJson.includes('A revised future default.'), false);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
