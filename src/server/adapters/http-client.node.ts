import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import test from 'node:test';
import { createHttpJsonClient, parsePrivateAddressCidrs } from './http-client.js';

const listen = (server: Server) =>
  new Promise<number>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      resolveListen(address.port);
    });
  });

const close = (server: Server) =>
  new Promise<void>((resolveClose, rejectClose) => {
    server.close(error => {
      if (error) rejectClose(error);
      else resolveClose();
    });
  });

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

test('accepts only valid explicit private source CIDRs', () => {
  assert.deepEqual(parsePrivateAddressCidrs(' 10.0.0.0/24,fd00::/8 '), ['10.0.0.0/24', 'fd00::/8']);
  for (const value of [
    '127.0.0.1',
    '10.0.0.0/33',
    'fd00::/129',
    'not-an-address/24',
    '0.0.0.0/0',
    '10.0.0.0/7',
    '2001:db8::/32',
  ]) {
    assert.throws(
      () => parsePrivateAddressCidrs(value),
      error =>
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'invalid_private_source_cidrs'
    );
  }
});

test('allows only private addresses contained by the configured CIDRs', async () => {
  let requests = 0;
  const client = createHttpJsonClient({
    privateAddressCidrs: ['10.20.30.0/24'],
    fetchImplementation: async () => {
      requests += 1;
      return Response.json({ ok: true });
    },
  });
  const result = await client(new URL('http://10.20.30.42/status'));
  assert.deepEqual(result.data, { ok: true });
  await assert.rejects(client(new URL('http://10.20.31.42/status')), error => {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'private_address_blocked'
    );
  });
  assert.equal(requests, 1);
});

test('enforces the decompressed response body limit', async () => {
  const client = createHttpJsonClient({
    privateAddressCidrs: ['127.0.0.1/32'],
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

test('rejects a redirect that leaves an allowed private CIDR', async () => {
  let requests = 0;
  const client = createHttpJsonClient({
    privateAddressCidrs: ['10.20.30.0/24'],
    fetchImplementation: async () => {
      requests += 1;
      return new Response(null, {
        status: 302,
        headers: { Location: 'http://10.20.31.1/private' },
      });
    },
  });
  await assert.rejects(client(new URL('http://10.20.30.1/status')), error => {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'private_address_blocked'
    );
  });
  assert.equal(requests, 1);
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

test('pins the connection to the prevalidated address without a second system lookup', async () => {
  let hostHeader = '';
  const server = createServer((request, response) => {
    hostHeader = request.headers.host ?? '';
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ pinned: true }));
  });
  try {
    const port = await listen(server);
    let resolutions = 0;
    const client = createHttpJsonClient({
      privateAddressCidrs: ['127.0.0.1/32'],
      resolveHost: async hostname => {
        assert.equal(hostname, 'source.invalid');
        resolutions += 1;
        return [{ address: '127.0.0.1', family: 4 }];
      },
    });
    const result = await client(new URL(`http://source.invalid:${port}/status`));
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { pinned: true });
    assert.equal(resolutions, 1);
    assert.equal(hostHeader, `source.invalid:${port}`);
  } finally {
    await close(server);
  }
});
