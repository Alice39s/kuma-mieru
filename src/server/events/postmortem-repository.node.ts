import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { openDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrator.js';
import { createPiiProtector } from '../subscriptions/crypto.js';
import { appendIncidentUpdate, createIncident } from './repository.js';
import {
  appendPostmortemUpdate,
  createPostmortem,
  getPostmortemPublicationReview,
  publishPostmortem,
} from './postmortem-repository.js';

const audit = { actorId: 'owner-1', requestId: 'postmortem-request-1' };

test('requires a resolved incident and inherits its subscriber scope', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-postmortem-'));
  const databasePath = resolve(directory, 'postmortem.sqlite3');
  const { database } = openDatabase(databasePath);
  try {
    await migrateDatabase(database, {
      directory: resolve(process.cwd(), 'migrations'),
      databasePath,
    });
    const incident = createIncident(
      database,
      {
        pageId: 'public',
        title: 'API outage',
        body: 'Investigating.',
        state: 'investigating',
        affectedComponentIds: ['api'],
      },
      'incident-for-postmortem',
      audit
    );
    const draft = {
      incidentId: incident.id,
      title: 'API outage review',
      body: 'Root cause and corrective actions.',
      state: 'draft' as const,
    };
    assert.throws(
      () => createPostmortem(database, draft, 'postmortem-1', audit),
      error => {
        assert.equal((error as { code: string }).code, 'incident_not_resolved');
        return true;
      }
    );
    appendIncidentUpdate(
      database,
      incident.id,
      { expectedVersion: 1, state: 'resolved', body: 'Service restored.' },
      audit
    );
    const postmortem = createPostmortem(database, draft, 'postmortem-2', audit);
    const reviewed = appendPostmortemUpdate(
      database,
      postmortem.id,
      { expectedVersion: 1, state: 'reviewed', body: 'Reviewed corrective actions.' },
      audit
    );
    database
      .prepare(
        `INSERT INTO email_subscriptions
          (id, page_id, incident_id, scope_key, component_ids_json, email_hash,
           email_ciphertext, state, created_at, confirmed_at, updated_at)
         VALUES ('incident-subscriber', 'public', ?, ?, '[]', 'hash', 'cipher', 'active', ?, ?, ?)`
      )
      .run(
        incident.id,
        `incident:${incident.id}`,
        new Date().toISOString(),
        new Date().toISOString(),
        new Date().toISOString()
      );
    const review = getPostmortemPublicationReview(database, reviewed.id, reviewed.version);
    assert.equal(review.estimatedRecipients, 1);
    const publication = publishPostmortem(
      database,
      {
        eventId: reviewed.id,
        expectedVersion: reviewed.version,
        notifySubscribers: true,
        expectedRecipients: 1,
        piiProtector: createPiiProtector('postmortem-test-secret-with-enough-entropy'),
      },
      audit
    );
    assert.equal(publication.incidentId, incident.id);
    assert.equal(
      (
        database.prepare('SELECT COUNT(*) AS count FROM notification_outbox').get() as {
          count: number;
        }
      ).count,
      1
    );
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
