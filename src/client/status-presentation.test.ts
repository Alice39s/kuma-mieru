import { describe, expect, test } from 'bun:test';
import {
  collectingBaselinePresentation,
  isCollectingBaselineEvidence,
  presentationForStatus,
  publicStatuses,
  statusForPublicEvidence,
  worstPublicStatus,
} from './status-presentation';

describe('public status presentation', () => {
  test('never lets an operational source hide unknown or outage evidence', () => {
    expect(worstPublicStatus(['operational', 'unknown'])).toBe('unknown');
    expect(worstPublicStatus(['unknown', 'degraded'])).toBe('unknown');
    expect(worstPublicStatus(['unknown', 'partial_outage'])).toBe('partial_outage');
    expect(worstPublicStatus(['unknown', 'major_outage'])).toBe('major_outage');
  });

  test('distinguishes fresh successful burn-in evidence from missing status', () => {
    expect(
      isCollectingBaselineEvidence({
        status: 'unknown',
        coverageState: 'implemented',
        freshnessState: 'fresh',
        sampleCount: 1,
        consumerSuccessCount: 1,
      })
    ).toBe(true);
    expect(
      isCollectingBaselineEvidence({
        status: 'unknown',
        coverageState: 'implemented',
        freshnessState: 'fresh',
        sampleCount: 1,
        consumerSuccessCount: 0,
      })
    ).toBe(false);
    expect(collectingBaselinePresentation.label).toBe('Establishing baseline');
  });

  test('uses pending until the first source status exists', () => {
    expect(worstPublicStatus([])).toBe('pending');
  });

  test('does not present stale or partial operational evidence as green', () => {
    expect(statusForPublicEvidence(['operational'], true)).toBe('unknown');
    expect(statusForPublicEvidence(['degraded'], true)).toBe('degraded');
    expect(statusForPublicEvidence([], true)).toBe('pending');
  });

  test('gives every wire status distinct nonempty text and an icon', () => {
    const labels = publicStatuses.map(status => presentationForStatus(status).label);
    expect(new Set(labels).size).toBe(publicStatuses.length);
    for (const status of publicStatuses) {
      const presentation = presentationForStatus(status);
      expect(presentation.summary.length).toBeGreaterThan(0);
      expect(presentation.badgeClassName.length).toBeGreaterThan(0);
      expect(presentation.Icon).toBeTruthy();
    }
  });
});
