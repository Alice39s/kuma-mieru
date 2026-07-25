import assert from 'node:assert/strict';
import { z } from 'zod';
import { fetchBetterStackSnapshot } from './better-stack/adapter.js';
import { createHttpJsonClient } from './http-client.js';
import { fetchIncidentIoSnapshot } from './incident-io/adapter.js';
import type { NormalizedSnapshot, SourceJsonRequester } from './types.js';
import { fetchUptimeKumaSnapshot } from './uptime-kuma/adapter.js';
import { createIconProxyService } from '../icon/service.js';

const targetsEnvironment = 'KUMA_MIERU_EXTERNAL_SOURCE_TARGETS';

const httpsUrlSchema = z.url().refine(
  value => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
  },
  { message: 'External smoke targets must use credential-free HTTPS URLs without fragments' }
);

const externalSourceTargetSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    kind: z.enum(['uptime-kuma', 'better-stack', 'incident-io']),
    baseUrl: httpsUrlSchema,
    pageId: z.string().trim().min(1).max(256),
    expectedTitle: z.string().min(1).max(512),
    minimumServices: z.number().int().nonnegative().max(100_000).default(0),
    verifyIcon: z.boolean().default(false),
  })
  .superRefine((target, context) => {
    if (target.kind === 'incident-io' && target.pageId !== 'summary') {
      context.addIssue({
        code: 'custom',
        path: ['pageId'],
        message: 'incident.io Widget smoke targets must use the summary page ID',
      });
    }
  });

const externalSourceTargetsSchema = z.array(externalSourceTargetSchema).min(1).max(10);
type ExternalSourceTarget = z.infer<typeof externalSourceTargetSchema>;

const createRequester = (): SourceJsonRequester => {
  const requestJson = createHttpJsonClient({
    timeoutMs: 20_000,
    maxBodyBytes: 2 * 1024 * 1024,
    maxRedirects: 3,
  });
  return {
    request: async (url, _resourceKey, schema, options) => {
      const response = await requestJson(url, options?.headers);
      assert.equal(response.status, 200, 'External smoke does not use a local HTTP cache');
      return schema.parse(response.data);
    },
  };
};

const fetchTarget = (
  target: ExternalSourceTarget,
  requester: SourceJsonRequester
): Promise<NormalizedSnapshot> => {
  const input = {
    sourceId: target.id,
    baseUrl: target.baseUrl,
    pageId: target.pageId,
  };
  switch (target.kind) {
    case 'better-stack':
      return fetchBetterStackSnapshot(input, requester);
    case 'incident-io':
      return fetchIncidentIoSnapshot(input, requester);
    case 'uptime-kuma':
      return fetchUptimeKumaSnapshot(input, requester);
  }
};

const rawTargets = process.env[targetsEnvironment];
if (!rawTargets) {
  throw new Error(
    `${targetsEnvironment} must contain an explicitly reviewed JSON target list; this smoke never chooses public targets implicitly`
  );
}

const targets = externalSourceTargetsSchema.parse(JSON.parse(rawTargets));
const requester = createRequester();
const iconProxy = createIconProxyService();
const evidence: Array<{
  id: string;
  kind: ExternalSourceTarget['kind'];
  origin: string;
  pageId: string;
  title: string;
  status: NormalizedSnapshot['status'];
  groups: number;
  services: number;
  incidents: number;
  capabilities: NormalizedSnapshot['capabilities'];
  icon: { contentType: string; bytes: number } | null;
}> = [];

for (const target of targets) {
  const snapshot = await fetchTarget(target, requester);
  assert.equal(snapshot.sourceId, target.id);
  assert.equal(snapshot.pageId, target.pageId);
  assert.equal(snapshot.title, target.expectedTitle);
  assert.equal(
    snapshot.services.length >= target.minimumServices,
    true,
    `${target.id} returned ${snapshot.services.length} services, expected at least ${target.minimumServices}`
  );
  assert.equal(snapshot.capabilities.currentStatus, true);
  let iconEvidence: { contentType: string; bytes: number } | null = null;
  if (target.verifyIcon) {
    const extension = z
      .object({ icon: z.string().min(1).max(2_048) })
      .parse(snapshot.extensions['uptime-kuma']);
    const icon = await iconProxy.fetch({
      icon: extension.icon,
      sourceBaseUrl: target.baseUrl,
    });
    assert.ok(icon, `${target.id} did not return an allowed same-origin icon`);
    iconEvidence = { contentType: icon.contentType, bytes: icon.bytes.byteLength };
  }
  evidence.push({
    id: target.id,
    kind: target.kind,
    origin: new URL(target.baseUrl).origin,
    pageId: target.pageId,
    title: snapshot.title,
    status: snapshot.status,
    groups: snapshot.groups.length,
    services: snapshot.services.length,
    incidents: snapshot.incidents.length,
    capabilities: snapshot.capabilities,
    icon: iconEvidence,
  });
}

process.stdout.write(
  `${JSON.stringify(
    {
      schemaVersion: 1,
      targetCount: evidence.length,
      targets: evidence,
    },
    null,
    2
  )}\n`
);
