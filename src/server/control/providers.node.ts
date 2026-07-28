import assert from 'node:assert/strict';
import test from 'node:test';
import { create } from '@bufbuild/protobuf';
import { HttpMethod, HttpMonitorDraftSchema } from './gen/kuma/mieru/control/v1/control_pb.js';
import {
  createHttpMonitor,
  getMonitor,
  listMonitors,
  setMonitorPaused,
  updateHttpMonitor,
  validateHttpMonitorDraft,
  type ProviderRuntime,
} from './providers.js';

const validDraft = () =>
  create(HttpMonitorDraftSchema, {
    displayName: 'Public API',
    url: 'https://example.com/health',
    method: HttpMethod.GET,
    intervalSeconds: 60,
    timeoutSeconds: 10,
    followRedirects: true,
  });

test('portable HTTP monitor validation accepts the common safe subset', () => {
  assert.doesNotThrow(() => validateHttpMonitorDraft(validDraft()));
});

test('portable HTTP monitor validation rejects credentials, HTTP and unsafe timing', () => {
  for (const patch of [
    { url: 'http://example.com/health' },
    { url: 'https://user:password@example.com/health' },
    { intervalSeconds: 10 },
    { timeoutSeconds: 4 },
    { intervalSeconds: 30, timeoutSeconds: 45 },
  ]) {
    const draft = create(HttpMonitorDraftSchema, { ...validDraft(), ...patch });
    assert.throws(
      () => validateHttpMonitorDraft(draft),
      error => (error as { code?: string }).code === 'invalid_argument'
    );
  }
});

test('UptimeRobot v3 adapter honors cursor pagination and direct monitor responses', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.includes('/monitors?')) {
      return Response.json({
        data: [
          {
            id: 42,
            friendlyName: 'API',
            url: 'https://example.com/health',
            status: 'UP',
            type: 'HTTP',
            interval: 60,
            timeout: 10,
            httpMethodType: 'GET',
            followRedirections: true,
          },
        ],
        nextLink: 'https://api.uptimerobot.com/v3/monitors?cursor=73',
      });
    }
    return Response.json(
      {
        id: 43,
        friendlyName: 'Created API',
        url: 'https://example.com/health',
        status: 'STARTED',
        type: 'HTTP',
        interval: 60,
        timeout: 10,
        httpMethodType: 'GET',
        followRedirections: true,
      },
      { status: init?.method === 'POST' ? 201 : 200 }
    );
  };
  const provider: ProviderRuntime = {
    id: 'uptime-robot',
    kind: 'uptime-robot-v3',
    token: 'test-token',
  };
  try {
    const page = await listMonitors(provider, 50);
    assert.equal(page.items[0]?.externalId, '42');
    assert.equal(page.nextPageToken, '73');
    const monitor = await getMonitor(provider, '43');
    assert.equal(monitor.displayName, 'Created API');
    const created = await createHttpMonitor(provider, validDraft());
    assert.equal(created.externalId, '43');
    const createRequest = requests.at(-1);
    assert.equal(createRequest?.init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(createRequest?.init?.body)), {
      friendlyName: 'Public API',
      type: 'HTTP',
      url: 'https://example.com/health',
      httpMethodType: 'GET',
      interval: 60,
      timeout: 10,
      followRedirections: true,
      successHttpResponseCodes: ['2xx'],
      assignedAlertContacts: [],
    });
    const updated = await updateHttpMonitor(provider, '43', validDraft(), ['display_name']);
    assert.equal(updated.externalId, '43');
    assert.equal(requests.at(-1)?.init?.method, 'PATCH');
    const paused = await setMonitorPaused(provider, '43', true);
    assert.equal(paused.externalId, '43');
    assert.match(requests.at(-1)?.url ?? '', /\/monitors\/43\/pause$/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('provider writes distinguish explicit failure from an uncertain network outcome', async () => {
  const originalFetch = globalThis.fetch;
  const provider: ProviderRuntime = {
    id: 'uptime-robot',
    kind: 'uptime-robot-v3',
    token: 'test-token',
  };
  try {
    globalThis.fetch = async () => Response.json({ error: 'invalid' }, { status: 400 });
    await assert.rejects(
      createHttpMonitor(provider, validDraft()),
      error =>
        (error as { code?: string; outcomeUnknown?: boolean }).code === 'provider_request_failed' &&
        (error as { outcomeUnknown?: boolean }).outcomeUnknown === false
    );

    globalThis.fetch = async () => {
      throw new Error('socket closed after send');
    };
    await assert.rejects(
      createHttpMonitor(provider, validDraft()),
      error =>
        (error as { code?: string; outcomeUnknown?: boolean }).code ===
          'provider_outcome_unknown' &&
        (error as { outcomeUnknown?: boolean }).outcomeUnknown === true
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Better Stack adapter emits an opaque numeric next-page token', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      data: [
        {
          id: 'monitor-1',
          type: 'monitor',
          attributes: {
            pronounceable_name: 'Homepage',
            url: 'https://example.com/',
            monitor_type: 'status',
            check_frequency: 30,
            request_timeout: 10,
            http_method: 'get',
            follow_redirects: true,
            paused_at: null,
          },
        },
      ],
      pagination: {
        next: 'https://uptime.betterstack.com/api/v2/monitors?per_page=50&page=2',
      },
    });
  try {
    const page = await listMonitors(
      { id: 'better-stack', kind: 'better-stack-uptime-v2', token: 'test-token' },
      50
    );
    assert.equal(page.items[0]?.externalId, 'monitor-1');
    assert.equal(page.nextPageToken, '2');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
