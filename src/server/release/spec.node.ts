import assert from 'node:assert/strict';
import test from 'node:test';
import { releaseSpecSchema, resolveReleaseRefPolicy } from './spec.js';

const baseSpec = {
  schemaVersion: 1 as const,
  product: 'kuma-mieru' as const,
  runtime: { node: '>=24 <27', uid: 10001, gid: 10001, dataDirectory: '/data' as const },
  database: { minimumSchemaVersion: 0, maximumSchemaVersion: 13 },
  container: {
    image: 'ghcr.io/alice39s/kuma-mieru',
    developmentTag: '2-dev' as const,
    readOnlyRootFilesystem: true as const,
    dropAllCapabilities: true as const,
    noNewPrivileges: true as const,
    dockerSocket: false as const,
  },
  compatibility: {
    supportedMajor: 2 as const,
    legacyRoutes: ['/'],
    legacyEnvironment: ['UPTIME_KUMA_URLS'],
  },
};

test('release specification binds semantic prerelease syntax to its channel', () => {
  assert.equal(
    releaseSpecSchema.safeParse({
      ...baseSpec,
      version: '2.0.0-dev',
      channel: 'development',
      stable: false,
    }).success,
    true
  );
  assert.equal(
    releaseSpecSchema.safeParse({
      ...baseSpec,
      version: '2.0.0-rc.1',
      channel: 'beta',
      stable: false,
    }).success,
    false
  );
  assert.equal(
    releaseSpecSchema.safeParse({
      ...baseSpec,
      version: '2.0.0',
      channel: 'stable',
      stable: false,
    }).success,
    false
  );
});

test('v2-dev publishes only mutable development and immutable commit tags', () => {
  const spec = releaseSpecSchema.parse({
    ...baseSpec,
    version: '2.0.0-dev',
    channel: 'development',
    stable: false,
  });
  assert.deepEqual(
    resolveReleaseRefPolicy(spec, {
      eventName: 'push',
      ref: 'refs/heads/v2-dev',
      commit: '0123456789abcdef',
      repository: 'Alice39s/kuma-mieru',
    }),
    {
      publish: true,
      immutableTag: 'sha-0123456789ab',
      tags: ['2-dev', 'sha-0123456789ab'],
      requireMainAncestry: false,
    }
  );
});

test('manual workflow dispatch builds evidence without publishing a tag', () => {
  const spec = releaseSpecSchema.parse({
    ...baseSpec,
    version: '2.0.0-dev',
    channel: 'development',
    stable: false,
  });
  assert.deepEqual(
    resolveReleaseRefPolicy(spec, {
      eventName: 'workflow_dispatch',
      ref: 'refs/heads/v2-dev',
      commit: '0123456789abcdef',
      repository: 'Alice39s/kuma-mieru',
    }),
    {
      publish: false,
      immutableTag: 'sha-0123456789ab',
      tags: ['sha-0123456789ab'],
      requireMainAncestry: false,
    }
  );
});

test('a fork can build the workflow but cannot publish official registry tags', () => {
  const spec = releaseSpecSchema.parse({
    ...baseSpec,
    version: '2.0.0-dev',
    channel: 'development',
    stable: false,
  });
  assert.deepEqual(
    resolveReleaseRefPolicy(spec, {
      eventName: 'push',
      ref: 'refs/heads/v2-dev',
      commit: '0123456789abcdef',
      repository: 'fork-owner/kuma-mieru',
    }),
    {
      publish: false,
      immutableTag: 'sha-0123456789ab',
      tags: ['sha-0123456789ab'],
      requireMainAncestry: false,
    }
  );
});

test('prerelease tags never produce stable aliases', () => {
  const spec = releaseSpecSchema.parse({
    ...baseSpec,
    version: '2.0.0-rc.3',
    channel: 'rc',
    stable: false,
  });
  const policy = resolveReleaseRefPolicy(spec, {
    eventName: 'push',
    ref: 'refs/tags/v2.0.0-rc.3',
    commit: 'fedcba9876543210',
    repository: 'Alice39s/kuma-mieru',
  });
  assert.deepEqual(policy.tags, ['2.0.0-rc.3', 'sha-fedcba987654']);
  assert.equal(policy.requireMainAncestry, false);
});

test('only an exact stable tag emits major, minor, and latest aliases', () => {
  const spec = releaseSpecSchema.parse({
    ...baseSpec,
    version: '2.4.1',
    channel: 'stable',
    stable: true,
  });
  const policy = resolveReleaseRefPolicy(spec, {
    eventName: 'push',
    ref: 'refs/tags/v2.4.1',
    commit: 'abcdef0123456789',
    repository: 'Alice39s/kuma-mieru',
  });
  assert.deepEqual(policy.tags, ['2.4.1', 'sha-abcdef012345', '2.4', '2', 'latest']);
  assert.equal(policy.requireMainAncestry, true);
  assert.throws(() =>
    resolveReleaseRefPolicy(spec, {
      eventName: 'push',
      ref: 'refs/heads/v2-dev',
      commit: 'abcdef0123456789',
      repository: 'Alice39s/kuma-mieru',
    })
  );
});
