import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { assertReleaseBuild, assertReleaseSchema, loadReleaseManifest } from './manifest.js';

const manifest = {
  schemaVersion: 1 as const,
  product: 'kuma-mieru' as const,
  version: '2.0.0-dev',
  channel: 'development' as const,
  stable: false,
  source: {
    commit: '0123456789abcdef',
    committedAt: '2026-07-25T00:00:00Z',
    dirty: false,
    verified: true,
  },
  database: { minimumSchemaVersion: 0, maximumSchemaVersion: 13 },
  container: {
    image: 'ghcr.io/alice39s/kuma-mieru',
    developmentTag: '2-dev',
    readOnlyRootFilesystem: true as const,
    dropAllCapabilities: true as const,
    noNewPrivileges: true as const,
    dockerSocket: false as const,
  },
  artifacts: [{ path: 'server/index.js', sha256: '0'.repeat(64), bytes: 1 }],
};

test('loads typed release evidence and rejects a mislabeled runtime', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-release-manifest-'));
  const path = resolve(directory, 'release-manifest.json');
  try {
    await writeFile(path, JSON.stringify(manifest));
    const loaded = await loadReleaseManifest(path, { required: true });
    assert.equal(loaded?.source.verified, true);
    assert.doesNotThrow(() => assertReleaseBuild(loaded!, '2.0.0-dev'));
    assert.doesNotThrow(() => assertReleaseSchema(loaded!, 13));
    assert.throws(
      () => assertReleaseBuild(loaded!, '2.0.1'),
      /differs from release manifest/u
    );
    assert.throws(
      () => assertReleaseSchema(loaded!, 14),
      /outside release range/u
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('allows a missing manifest only for a development runtime', async () => {
  const missing = resolve(tmpdir(), 'kuma-mieru-release-manifest-does-not-exist.json');
  assert.equal(await loadReleaseManifest(missing, { required: false }), null);
  await assert.rejects(loadReleaseManifest(missing, { required: true }), /ENOENT/u);
});
