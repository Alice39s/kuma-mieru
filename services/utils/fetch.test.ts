import { expect, test } from 'bun:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { customFetch } from './fetch';

test('a timeout performs exactly the configured number of retries', async () => {
  let requests = 0;
  const server = createServer(() => {
    requests++;
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP listener');
  try {
    await expect(
      customFetch(`http://127.0.0.1:${address.port}`, {
        maxRetries: 1,
        retryDelay: 5,
        timeout: 30,
      })
    ).rejects.toMatchObject({ code: 'ETIMEDOUT' });
    expect(requests).toBe(2);
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }
});

test('response text, JSON and bytes preserve the same payload', async () => {
  const payload = '{"status":"ok"}';
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(payload);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP listener');
  try {
    const response = await customFetch(`http://127.0.0.1:${address.port}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(payload);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(new TextDecoder().decode(await response.arrayBuffer())).toBe(payload);
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }
});
