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
