import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLegacyMigrationPlan } from './legacy-compatibility.js';

test('maps v1 precedence and records secure no-effect decisions', () => {
  const plan = buildLegacyMigrationPlan({
    environment: {
      UPTIME_KUMA_URLS:
        'https://status.example.com/status/main|https://cn.example.com/prefix/status/cn',
      UPTIME_KUMA_BASE_URL: 'https://ignored.example.com',
      PAGE_ID: 'ignored',
      KUMA_MIERU_TITLE: 'Preferred title',
      FEATURE_TITLE: 'Fallback title',
      FEATURE_DESCRIPTION: 'Legacy description',
      KUMA_MIERU_EDIT_THIS_PAGE: 'true',
      REQUEST_TIMEOUT_MS: '7500',
      ALLOW_INSECURE_TLS: 'true',
      SSR_STRICT_MODE: 'true',
    },
  });
  assert.equal(plan.source, 'environment_urls');
  assert.equal(plan.config.pages[0]?.title, 'Preferred title');
  assert.equal(plan.config.pages[0]?.description, 'Legacy description');
  assert.equal(plan.config.pages[0]?.features?.editThisPage, true);
  assert.equal(plan.config.sources[0]?.requestPolicy?.timeoutMs, 7500);
  assert.equal(plan.config.sources[1]?.baseUrl, 'https://cn.example.com/prefix');
  assert.equal(plan.conflicts.length, 1);
  assert.equal(
    plan.decisions.find(item => item.key === 'FEATURE_TITLE')?.status,
    'ignored_by_precedence'
  );
  assert.equal(
    plan.decisions.find(item => item.key === 'ALLOW_INSECURE_TLS')?.status,
    'accepted_no_effect'
  );
  assert.deepEqual(plan.ignoredFields, ['ALLOW_INSECURE_TLS', 'SSR_STRICT_MODE']);
});

test('uses the generated v1 JSON as a migration source without flattening page metadata', () => {
  const plan = buildLegacyMigrationPlan({
    environment: {},
    generatedConfig: {
      baseUrl: 'https://status.example.com',
      pageId: 'main',
      pageIds: ['main'],
      pages: [
        {
          id: 'main',
          baseUrl: 'https://status.example.com',
          siteMeta: {
            title: 'Generated status',
            description: 'Generated description',
            icon: '/generated.svg',
          },
        },
      ],
      siteMeta: {
        title: 'Generated status',
        description: 'Generated description',
        icon: '/generated.svg',
      },
      isEditThisPage: false,
      isShowStarButton: true,
    },
  });
  assert.equal(plan.source, 'generated_json');
  assert.deepEqual(plan.config.pages[0], {
    id: 'legacy-1-main',
    slug: 'main',
    title: 'Generated status',
    description: 'Generated description',
    icon: '/generated.svg',
    features: { editThisPage: false, showStarButton: true },
    sourceRefs: ['legacy-1'],
  });
});
