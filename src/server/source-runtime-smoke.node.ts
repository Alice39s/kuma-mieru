import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

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

const availablePort = async () => {
  const server = createServer();
  const port = await listen(server);
  await close(server);
  return port;
};

const stopChild = async (child: ChildProcessWithoutNullStreams) => {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    once(child, 'exit'),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Kuma Mieru did not stop after SIGTERM')), 5_000).unref();
    }),
  ]);
};

test('boots the real server, polls Uptime Kuma, and projects one local snapshot', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-runtime-smoke-'));
  const dataDirectory = resolve(directory, 'data');
  const configPath = resolve(directory, 'config.json');
  const requestedPaths: string[] = [];
  const upstream = createServer((request, response) => {
    requestedPaths.push(request.url ?? '');
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/status-page/main') {
      response.end(
        JSON.stringify({
          config: {
            title: 'Runtime Smoke Status',
            description: 'Real process-level Uptime Kuma fixture',
          },
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
            '42': [
              {
                status: 0,
                time: '2026-07-25T03:00:00.000Z',
                ping: null,
              },
            ],
          },
          uptimeList: { '42_24': 0.9 },
        })
      );
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'not_found' }));
  });
  let child: ChildProcessWithoutNullStreams | null = null;
  try {
    const upstreamPort = await listen(upstream);
    const appPort = await availablePort();
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        sources: [
          {
            id: 'primary',
            kind: 'uptime-kuma',
            baseUrl: `http://127.0.0.1:${upstreamPort}`,
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
      }),
      { mode: 0o600 }
    );

    const output: string[] = [];
    const processChild = spawn(process.execPath, [resolve(import.meta.dirname, 'index.js')], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: String(appPort),
        KUMA_MIERU_ALLOW_PRIVATE_SOURCES: 'true',
        KUMA_MIERU_BACKUP_SCHEDULE_ENABLED: 'false',
        KUMA_MIERU_BASE_URL: `http://127.0.0.1:${appPort}`,
        KUMA_MIERU_CONFIG: configPath,
        KUMA_MIERU_CONFIG_MODE: 'file',
        KUMA_MIERU_DATA_DIR: dataDirectory,
        KUMA_MIERU_RETENTION_SCHEDULE_ENABLED: 'false',
        KUMA_MIERU_SETUP_TOKEN: 'runtime-smoke-owner-setup-token-0001',
        NODE_ENV: 'development',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child = processChild;
    processChild.stdin.end();
    processChild.stdout.setEncoding('utf8');
    processChild.stderr.setEncoding('utf8');
    processChild.stdout.on('data', chunk => output.push(String(chunk)));
    processChild.stderr.on('data', chunk => output.push(String(chunk)));

    const baseUrl = `http://127.0.0.1:${appPort}`;
    const deadline = Date.now() + 10_000;
    let snapshotResponse: Response | null = null;
    while (Date.now() < deadline) {
      if (processChild.exitCode !== null) {
        throw new Error(`Kuma Mieru exited before readiness:\n${output.join('')}`);
      }
      try {
        const readiness = await fetch(`${baseUrl}/health/ready`);
        if (readiness.ok) {
          const candidate = await fetch(`${baseUrl}/api/v1/public/pages/main/snapshot`);
          if (candidate.ok) {
            snapshotResponse = candidate;
            break;
          }
        }
      } catch {
        // The process may still be binding its listener.
      }
      await new Promise(resolveWait => setTimeout(resolveWait, 25));
    }
    assert.ok(snapshotResponse, `Source snapshot was not ready:\n${output.join('')}`);

    const snapshotBody = (await snapshotResponse.json()) as {
      data: Array<{
        health: { stale: boolean };
        snapshot: {
          sourceId: string;
          pageId: string;
          title: string;
          status: string;
          services: Array<{ name: string; status: string }>;
        };
      }>;
      meta: { status: string };
    };
    assert.equal(snapshotBody.meta.status, 'ok');
    assert.equal(snapshotBody.data[0]?.health.stale, false);
    assert.equal(snapshotBody.data[0]?.snapshot.sourceId, 'primary');
    assert.equal(snapshotBody.data[0]?.snapshot.pageId, 'main');
    assert.equal(snapshotBody.data[0]?.snapshot.title, 'Runtime Smoke Status');
    assert.equal(snapshotBody.data[0]?.snapshot.status, 'major_outage');
    assert.deepEqual(snapshotBody.data[0]?.snapshot.services, [
      {
        id: 'primary:monitor:42',
        sourceId: 'primary',
        upstreamId: '42',
        name: 'Inference API',
        groupId: 'primary:group:1',
        tags: [],
        status: 'major_outage',
        rawStatus: 0,
        latencyMs: null,
        observedAt: '2026-07-25T03:00:00.000Z',
        uptime24h: 0.9,
      },
    ]);

    const legacyConfigResponse = await fetch(`${baseUrl}/api/config?pageId=main`);
    assert.equal(legacyConfigResponse.status, 200);
    const legacyConfig = (await legacyConfigResponse.json()) as {
      config: { title: string };
      status: string;
      success: boolean;
    };
    assert.equal(legacyConfig.success, true);
    assert.equal(legacyConfig.status, 'ok');
    assert.equal(legacyConfig.config.title, 'Status');

    const legacyMonitorResponse = await fetch(`${baseUrl}/api/monitor?pageId=main`);
    assert.equal(legacyMonitorResponse.status, 200);
    const legacyMonitor = (await legacyMonitorResponse.json()) as {
      monitorGroups: Array<{
        name: string;
        monitorList: Array<{ name: string }>;
      }>;
      status: string;
      success: boolean;
    };
    assert.equal(legacyMonitor.success, true);
    assert.equal(legacyMonitor.status, 'ok');
    assert.equal(legacyMonitor.monitorGroups[0]?.name, 'Core');
    assert.equal(legacyMonitor.monitorGroups[0]?.monitorList[0]?.name, 'Inference API');
    assert.ok(requestedPaths.includes('/api/status-page/main'));
    assert.ok(requestedPaths.includes('/api/status-page/heartbeat/main'));

    await stopChild(processChild);
    assert.equal(processChild.exitCode, 0, output.join(''));
  } finally {
    if (child) await stopChild(child);
    await close(upstream);
    await rm(directory, { recursive: true, force: true });
  }
});
