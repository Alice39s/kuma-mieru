import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { canonicalConfigSchema } from '../config/schema.js';
import { openDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrator.js';
import { listAutomationSuggestions } from '../events/automation-repository.js';
import { startSourcePoller } from './source-poller.js';

test('polls successful source snapshots into a private debounced suggestion', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-source-poller-'));
  const databasePath = resolve(directory, 'poller.sqlite3');
  const { database } = openDatabase(databasePath);
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/status-page/main') {
      response.end(
        JSON.stringify({
          config: { title: 'Live Test Status', description: 'Poller integration fixture' },
          publicGroupList: [
            {
              id: 1,
              name: 'Core',
              weight: 1,
              monitorList: [{ id: 42, name: 'Inference API', tags: [] }],
            },
          ],
          maintenanceList: [],
        })
      );
      return;
    }
    if (request.url === '/api/status-page/heartbeat/main') {
      response.end(
        JSON.stringify({
          heartbeatList: {
            '42': [{ status: 0, time: new Date().toISOString(), ping: null }],
          },
          uptimeList: { '42_24': 0.9 },
        })
      );
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'not_found' }));
  });
  try {
    await migrateDatabase(database, {
      directory: resolve(process.cwd(), 'migrations'),
      databasePath,
    });
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(0, '127.0.0.1', () => resolveListen());
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const config = canonicalConfigSchema.parse({
      schemaVersion: 1,
      sources: [
        {
          id: 'primary',
          kind: 'uptime-kuma',
          baseUrl: `http://127.0.0.1:${address.port}`,
          pageIds: ['main'],
        },
      ],
      pages: [
        {
          id: 'public',
          slug: 'main',
          title: 'Status',
          sourceRefs: ['primary'],
        },
      ],
      events: {
        automation: {
          defaultAction: 'suggest-draft',
          degradedConsecutive: 3,
          recoveryConsecutive: 2,
          cooldownMs: 60_000,
        },
      },
    });
    const stop = startSourcePoller({
      database,
      config,
      allowPrivateAddresses: true,
      intervalMs: 25,
      staleAfterMs: 1_000,
    });
    try {
      const deadline = Date.now() + 3_000;
      while (listAutomationSuggestions(database, 'pending').length === 0) {
        if (Date.now() >= deadline) throw new Error('poller did not create a suggestion in time');
        await new Promise(resolveWait => setTimeout(resolveWait, 20));
      }
    } finally {
      stop();
    }

    const suggestion = listAutomationSuggestions(database, 'pending')[0];
    assert.equal(suggestion?.kind, 'degradation');
    assert.equal(suggestion?.pageId, 'public');
    assert.equal(suggestion?.serviceId, 'primary:monitor:42');
    assert.equal(suggestion?.notificationEligible, false);
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
  } finally {
    await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
