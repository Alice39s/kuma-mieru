import assert from 'node:assert/strict';
import test from 'node:test';
import { createHttpJsonClient } from './http-client.js';

test('blocks direct requests to private addresses before fetch', async () => {
  let fetched = false;
  const client = createHttpJsonClient({
    fetchImplementation: async () => {
      fetched = true;
      return Response.json({ ok: true });
    },
  });
  await assert.rejects(client(new URL('http://127.0.0.1/status')), error => {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'private_address_blocked'
    );
  });
  assert.equal(fetched, false);
});

test('enforces the decompressed response body limit', async () => {
  const client = createHttpJsonClient({
    allowPrivateAddresses: true,
    maxBodyBytes: 16,
    fetchImplementation: async () => Response.json({ payload: 'a'.repeat(100) }),
  });
  await assert.rejects(client(new URL('http://127.0.0.1/status')), error => {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'body_too_large'
    );
  });
});

test('revalidates redirect targets and blocks a redirect to localhost', async () => {
  const client = createHttpJsonClient({
    resolveHost: async () => [{ address: '203.0.113.10', family: 4 }],
    fetchImplementation: async () =>
      new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/private' } }),
  });
  await assert.rejects(client(new URL('https://status.example.com/public')), error => {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'private_address_blocked'
    );
  });
});

test('strips credentials before following a cross-origin redirect', async () => {
  const requests: Array<{ url: string; authorization: string | null; safeHeader: string | null }> =
    [];
  const client = createHttpJsonClient({
    resolveHost: async () => [{ address: '203.0.113.10', family: 4 }],
    fetchImplementation: async (input, init) => {
      const headers = new Headers(init?.headers);
      requests.push({
        url: String(input),
        authorization: headers.get('authorization'),
        safeHeader: headers.get('x-safe'),
      });
      return requests.length === 1
        ? new Response(null, {
            status: 302,
            headers: { Location: 'https://api-two.example.com/status' },
          })
        : Response.json({ ok: true });
    },
  });
  await client(new URL('https://api-one.example.com/status'), {
    Authorization: 'Bearer private-token',
    'X-Safe': 'preserved',
  });
  assert.equal(requests[0]?.authorization, 'Bearer private-token');
  assert.equal(requests[1]?.authorization, null);
  assert.equal(requests[1]?.safeHeader, 'preserved');
});
