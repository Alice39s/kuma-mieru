import { createServer } from 'node:http';
import { afterEach, expect, test } from 'bun:test';
import { customFetchCore } from './custom-fetch-core';

const servers = new Set();

afterEach(async () => {
  await Promise.all(Array.from(servers, server => new Promise(resolve => server.close(resolve))));
  servers.clear();
});

const listen = handler =>
  new Promise(resolve => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      servers.add(server);
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });

test('customFetch rejects responses that exceed maxResponseBytes while reading', async () => {
  const { url } = await listen((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.write('12345');
    response.end('67890');
  });

  await expect(customFetchCore(url, { maxResponseBytes: 8, maxRetries: 0 })).rejects.toMatchObject({
    code: 'ERESPONSETOOLARGE',
  });
});

test('customFetch allows responses that fit within maxResponseBytes', async () => {
  const { url } = await listen((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end('ok');
  });

  const response = await customFetchCore(url, { maxResponseBytes: 2, maxRetries: 0 });

  expect(response.ok).toBe(true);
  expect(await response.text()).toBe('ok');
});

test('customFetch normalizes request headers before sending them to node http', async () => {
  let receivedHeaders;
  const { url } = await listen((request, response) => {
    receivedHeaders = request.headers;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{"ok":true}');
  });

  await customFetchCore(url, {
    headers: {
      'X-Retry-Count': 3,
      'X-Enabled': false,
      'X-Skip': undefined,
    },
    maxRetries: 0,
  });

  expect(receivedHeaders['x-retry-count']).toBe('3');
  expect(receivedHeaders['x-enabled']).toBe('false');
  expect(receivedHeaders['x-skip']).toBeUndefined();
});
