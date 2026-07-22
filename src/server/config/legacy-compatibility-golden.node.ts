import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { z } from 'zod';
import { buildLegacyMigrationPlan, legacyEnvironmentKeys } from './legacy-compatibility.js';

const statusSchema = z.enum(['mapped', 'ignored_by_precedence', 'accepted_no_effect']);
const projectedSourceSchema = z.object({
  baseUrl: z.string(),
  pageIds: z.array(z.string()),
  timeoutMs: z.number().nullable(),
});
const projectedPageSchema = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  editThisPage: z.boolean(),
  showStarButton: z.boolean(),
});
const matrixSchema = z.object({
  schemaVersion: z.literal(1),
  cases: z.array(
    z.object({
      name: z.string().min(1),
      environment: z.record(z.string(), z.string()),
      generatedConfig: z.unknown().optional(),
      expected: z.object({
        source: z.enum(['environment_urls', 'environment_base', 'generated_json']),
        sources: z.array(projectedSourceSchema),
        pages: z.array(projectedPageSchema),
        decisionStatuses: z.record(z.string(), statusSchema),
        conflicts: z.array(z.string()),
        ignoredFields: z.array(z.string()),
      }),
    })
  ),
});

const fixture = matrixSchema.parse(
  JSON.parse(
    await readFile(
      resolve(process.cwd(), 'fixtures', 'v1-compatibility', 'environment-matrix.json'),
      'utf8'
    )
  )
);
const releaseCompatibility = z
  .object({
    compatibility: z.object({ legacyEnvironment: z.array(z.string()) }),
  })
  .parse(
    JSON.parse(await readFile(resolve(process.cwd(), 'release', 'v2', 'release-spec.json'), 'utf8'))
  ).compatibility;

test('v2 release evidence lists the complete legacy environment contract', () => {
  assert.deepEqual(releaseCompatibility.legacyEnvironment, [...legacyEnvironmentKeys]);
});

fixture.cases.forEach(fixtureCase => {
  test(`v1 compatibility golden: ${fixtureCase.name}`, () => {
    const plan = buildLegacyMigrationPlan({
      environment: fixtureCase.environment,
      generatedConfig: fixtureCase.generatedConfig,
    });
    const projected = {
      source: plan.source,
      sources: plan.config.sources.map(source => ({
        baseUrl: source.baseUrl,
        pageIds: source.pageIds,
        timeoutMs: source.requestPolicy?.timeoutMs ?? null,
      })),
      pages: plan.config.pages.map(page => ({
        slug: page.slug,
        title: page.title,
        description: page.description ?? null,
        icon: page.icon ?? null,
        editThisPage: page.features?.editThisPage ?? false,
        showStarButton: page.features?.showStarButton ?? true,
      })),
      decisionStatuses: Object.fromEntries(
        plan.decisions.map(item => [item.key, item.status] as const)
      ),
      conflicts: plan.conflicts,
      ignoredFields: plan.ignoredFields,
    };
    assert.deepEqual(projected, fixtureCase.expected);
  });
});
