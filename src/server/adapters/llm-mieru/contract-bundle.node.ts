import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { z } from 'zod';
import { openDatabase } from '../../db/database.js';
import { migrateDatabase } from '../../db/migrator.js';
import {
  getMirroredEventTimeline,
  listMirroredEvents,
  reconcileMirroredEvents,
} from '../../events/mirrored-repository.js';
import type { SourceJsonRequester } from '../types.js';
import {
  fetchLlmMieruIncidents,
  fetchLlmMieruMethodology,
  fetchLlmMieruMetrics,
  fetchLlmMieruSnapshot,
} from './adapter.js';
import { llmMieruMetaSchema, llmMieruStatusSnapshotSchema } from './schemas.js';

const fixtureResponseSchema = z.object({
  request: z.string().min(1),
  status: z.number().int(),
  headers: z.record(z.string(), z.string()),
  body: z.unknown(),
});

const scenarioSchema = z.object({
  id: z.string().min(1),
  classification: z.string().min(1),
  responses: z.array(fixtureResponseSchema),
});

const transportCaseSchema = z
  .object({
    id: z.string().min(1),
    outcome: z.string().min(1),
    status: z.number().int().optional(),
    consumerExpectation: z.string().min(1),
  })
  .loose();

const adversarialCaseSchema = z.object({
  id: z.string().min(1),
  classification: z.string().min(1),
  rawBody: z.string(),
  consumerExpectation: z.string().min(1),
});

const bundleSchema = z.object({
  schemaVersion: z.literal(1),
  contractVersion: z.literal('1.0'),
  frozenAt: z.string().datetime({ offset: true }),
  compatibility: z.object({
    currentProducer: z.literal('1.0'),
    previousMinor: z.object({
      state: z.literal('not_applicable'),
      reasonCode: z.literal('first_published_minor_has_no_predecessor'),
      activationRule: z.string().min(1),
    }),
  }),
  capabilityGates: z.array(
    z.object({
      id: z.string().min(1),
      state: z.string().min(1),
      reasonCode: z.string().min(1),
    })
  ),
  scenarios: z.array(scenarioSchema),
  transportCases: z.array(transportCaseSchema),
  consumerAdversarialCases: z.array(adversarialCaseSchema),
});

type Bundle = z.infer<typeof bundleSchema>;
type Scenario = z.infer<typeof scenarioSchema>;

const fixtureDirectory = resolve(process.cwd(), 'fixtures', 'llm-mieru', 'v1.0');

const loadBundle = async (): Promise<Bundle> => {
  const contents = await readFile(resolve(fixtureDirectory, 'producer-fixtures.json'));
  const checksum = await readFile(resolve(fixtureDirectory, 'SHA256SUMS'), 'utf8');
  const digest = createHash('sha256').update(contents).digest('hex');
  assert.equal(checksum, `${digest}  producer-fixtures.json\n`);
  return bundleSchema.parse(JSON.parse(contents.toString('utf8')));
};

const scenarioById = (bundle: Bundle, id: string) => {
  const scenario = bundle.scenarios.find(candidate => candidate.id === id);
  assert.ok(scenario, `Missing frozen scenario ${id}`);
  return scenario;
};

const responseByRequest = (scenario: Scenario, request: string) => {
  const response = scenario.responses.find(candidate => candidate.request === request);
  assert.ok(response, `Missing ${request} in scenario ${scenario.id}`);
  assert.equal(response.status, 200);
  return response;
};

const requesterFor = (scenario: Scenario, requested: string[]): SourceJsonRequester => ({
  request: async (url, _resourceKey, schema) => {
    const request = `GET ${url.pathname}${url.search}`;
    requested.push(request);
    return schema.parse(responseByRequest(scenario, request).body);
  },
});

const tableCount = (database: ReturnType<typeof openDatabase>['database'], tableName: string) =>
  (
    database.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as {
      count: number;
    }
  ).count;

test('replays the complete five-region producer contract through metrics and mirrored events', async () => {
  const bundle = await loadBundle();
  const scenario = scenarioById(bundle, 'full-five-region');
  const requested: string[] = [];
  const requester = requesterFor(scenario, requested);
  const meta = llmMieruMetaSchema.parse(responseByRequest(scenario, 'GET /api/v1/meta').body);
  const snapshot = await fetchLlmMieruSnapshot(
    {
      sourceId: 'llm',
      baseUrl: 'https://fixture.invalid',
      pageId: 'default',
    },
    requester
  );
  const metrics = await fetchLlmMieruMetrics(
    {
      sourceId: 'llm',
      baseUrl: 'https://fixture.invalid',
      features: meta.features,
    },
    requester
  );
  const methodology = await fetchLlmMieruMethodology(
    {
      baseUrl: 'https://fixture.invalid',
      features: meta.features,
    },
    requester
  );

  assert.equal(snapshot.services.length, 5);
  assert.equal(snapshot.groups.length, 3);
  assert.equal(snapshot.status, 'degraded');
  assert.deepEqual(snapshot.services.map(service => service.tags[2]?.value).sort(), [
    'ap-northeast-tyo',
    'cn-east-sha',
    'eu-central-ber',
    'us-east-iad',
    'us-west-sjc',
  ]);
  assert.equal(snapshot.incidents.length, 1);
  assert.equal(snapshot.incidents[0]?.sourceEventId, 'incident-fixture-1');
  assert.equal(metrics?.catalog.length, 2);
  assert.equal(metrics?.series.length, 2);
  const ttft = metrics?.series.find(series => series.metricId === 'ttft_visible_ms');
  assert.equal(ttft?.points.length, 5);
  assert.deepEqual(ttft?.points.map(point => point.dimensions.observedRegion).sort(), [
    'ap-northeast-tyo',
    'cn-east-sha',
    'eu-central-ber',
    'us-east-iad',
    'us-west-sjc',
  ]);
  const cost = metrics?.series.find(series => series.metricId === 'probe_cost_micros');
  assert.deepEqual(cost?.points[0]?.value, {
    currency: 'USD',
    estimatedUpperBound: 12,
    reserved: 12,
    successfulReserved: 12,
    reservedPerConsumerSuccess: 12,
    consumerSuccessCount: 1,
    pricedSampleCount: 1,
    budgetSkippedCount: 0,
  });
  assert.equal(methodology?.statusSemantics.unknownIsHealthy, false);
  assert.deepEqual(methodology?.evidenceLinks, ['docs/contracts/llm-measurement-protocol.md']);
  assert.deepEqual(requested.sort(), [
    'GET /api/v1/incidents',
    'GET /api/v1/meta',
    'GET /api/v1/methodology/protocols',
    'GET /api/v1/metrics/catalog',
    'GET /api/v1/metrics/query?metric=probe_cost_micros&window=5m',
    'GET /api/v1/metrics/query?metric=ttft_visible_ms&window=5m',
    'GET /api/v1/services',
    'GET /api/v1/status/snapshot',
  ]);

  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-llm-contract-'));
  const databasePath = resolve(directory, 'contract.sqlite3');
  const { database } = openDatabase(databasePath);
  try {
    await migrateDatabase(database, {
      directory: resolve(process.cwd(), 'migrations'),
      databasePath,
    });
    assert.deepEqual(
      reconcileMirroredEvents(database, snapshot, {
        sourceUrl: 'https://reader:secret@fixture.invalid/status?token=hidden',
      }),
      { created: 1, updated: 0, absent: 0, reappeared: 0, unchanged: 0 }
    );
    const mirrored = listMirroredEvents(database, [{ sourceId: 'llm', pageId: 'default' }]);
    assert.equal(mirrored.length, 1);
    assert.equal(mirrored[0]?.origin, 'mirrored');
    assert.equal(mirrored[0]?.notificationEligible, false);
    assert.equal(mirrored[0]?.source.url, 'https://fixture.invalid/status');
    assert.deepEqual(
      getMirroredEventTimeline(
        database,
        [{ sourceId: 'llm', pageId: 'default' }],
        mirrored[0]!.id
      )?.entries.map(entry => entry.observationKind),
      ['initial']
    );
    assert.equal(tableCount(database, 'event_publications'), 0);
    assert.equal(tableCount(database, 'notification_outbox'), 0);
    assert.equal(tableCount(database, 'native_events'), 0);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('replays reduced capability and fail-closed status scenarios', async () => {
  const bundle = await loadBundle();
  const statusOnly = scenarioById(bundle, 'status-only');
  const requested: string[] = [];
  const meta = llmMieruMetaSchema.parse(responseByRequest(statusOnly, 'GET /api/v1/meta').body);
  const snapshot = await fetchLlmMieruSnapshot(
    {
      sourceId: 'llm-status-only',
      baseUrl: 'https://fixture.invalid',
      pageId: 'default',
    },
    requesterFor(statusOnly, requested)
  );
  assert.equal(snapshot.status, 'operational');
  assert.equal(snapshot.services.length, 1);
  assert.equal(snapshot.capabilities.nativeMetrics, false);
  assert.equal(snapshot.capabilities.incidents, 'none');
  assert.equal(
    await fetchLlmMieruMetrics(
      {
        sourceId: 'llm-status-only',
        baseUrl: 'https://fixture.invalid',
        features: meta.features,
      },
      requesterFor(statusOnly, requested)
    ),
    null
  );
  assert.equal(
    await fetchLlmMieruMethodology(
      {
        baseUrl: 'https://fixture.invalid',
        features: meta.features,
      },
      requesterFor(statusOnly, requested)
    ),
    null
  );
  assert.deepEqual(requested.sort(), [
    'GET /api/v1/meta',
    'GET /api/v1/services',
    'GET /api/v1/status/snapshot',
  ]);

  const unknownScenario = scenarioById(bundle, 'unknown-stale-unsupported');
  const unknownBody = responseByRequest(unknownScenario, 'GET /api/v1/status/snapshot').body;
  const unknownSnapshot = llmMieruStatusSnapshotSchema.parse(unknownBody);
  const syntheticRequester: SourceJsonRequester = {
    request: async (url, _resourceKey, schema) => {
      if (url.pathname.endsWith('/meta')) {
        return schema.parse({
          apiVersion: '1.0',
          schemaVersion: '1.0',
          instanceId: 'unknown-fixture',
          generatedAt: '2026-07-25T00:00:00Z',
          protocolVersions: ['1.0'],
          features: ['status-snapshot', 'service-catalog'],
        });
      }
      return schema.parse(unknownSnapshot);
    },
  };
  const normalizedUnknown = await fetchLlmMieruSnapshot(
    {
      sourceId: 'llm-unknown',
      baseUrl: 'https://fixture.invalid',
      pageId: 'default',
    },
    syntheticRequester
  );
  assert.equal(normalizedUnknown.status, 'unknown');
  assert.equal(normalizedUnknown.services[0]?.status, 'unknown');
});

test('passes opaque incident cursors through unchanged and consumes the frozen failure matrix', async () => {
  const bundle = await loadBundle();
  const scenario = scenarioById(bundle, 'incident-cursor-multipage');
  const requested: string[] = [];
  const incidents = await fetchLlmMieruIncidents(
    {
      baseUrl: 'https://fixture.invalid',
      limit: 1,
    },
    requesterFor(scenario, requested)
  );
  const firstPage = responseByRequest(scenario, 'GET /api/v1/incidents?limit=1');
  const firstBody = z
    .object({ nextCursor: z.string().min(1), data: z.array(z.unknown()) })
    .parse(firstPage.body);
  assert.deepEqual(requested, [
    'GET /api/v1/incidents?limit=1',
    `GET /api/v1/incidents?limit=1&cursor=${firstBody.nextCursor}`,
  ]);
  assert.deepEqual(
    incidents.data.map(incident => incident.id),
    ['incident-fixture-2', 'incident-fixture-1']
  );

  assert.deepEqual(bundle.transportCases.map(item => [item.id, item.consumerExpectation]).sort(), [
    ['forbidden', 'auth_forbidden'],
    ['malformed', 'malformed_response'],
    ['not-modified', 'reuse_cached_representation'],
    ['oversized', 'body_too_large'],
    ['rate-limited', 'rate_limited'],
    ['server-error', 'upstream_failed'],
    ['timeout', 'serve_last_known_good_then_stale'],
    ['unauthorized', 'auth_failed'],
    ['unsupported-protocol', 'hide_unsupported_protocol_metrics'],
  ]);
  assert.deepEqual(
    bundle.consumerAdversarialCases.map(item => [
      item.id,
      item.classification,
      item.consumerExpectation,
    ]),
    [
      [
        'unknown-status-enum',
        'consumer_adversarial_not_producer_valid',
        'unknown_enum_must_not_map_to_healthy',
      ],
      ['unknown-optional-field', 'consumer_forward_compatibility', 'ignore_unknown_optional_field'],
    ]
  );
  const unknownOptional = bundle.consumerAdversarialCases.find(
    item => item.id === 'unknown-optional-field'
  );
  assert.ok(unknownOptional);
  assert.equal(llmMieruMetaSchema.parse(JSON.parse(unknownOptional.rawBody)).apiVersion, '1.0');
  const unknownEnum = bundle.consumerAdversarialCases.find(
    item => item.id === 'unknown-status-enum'
  );
  assert.ok(unknownEnum);
  assert.equal(
    llmMieruStatusSnapshotSchema.safeParse(JSON.parse(unknownEnum.rawBody)).success,
    false
  );
});
