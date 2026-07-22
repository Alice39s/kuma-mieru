import { expect, test } from 'bun:test';
import { ZodError } from 'zod';
import {
  parseGlobalConfigData,
  parsePreloadData,
  parseSiteConfig,
  parseVisibleIncidents,
} from './preload-data-schema';

const validConfig = {
  slug: 'status',
  title: 'Status',
  description: 'Service status',
  icon: '/icon.svg',
  theme: 'dark',
  published: true,
  showTags: true,
  customCSS: '',
  footerText: '',
  showPoweredBy: false,
  googleAnalyticsId: null,
  showCertificateExpiry: false,
};

test('parsePreloadData validates the Uptime Kuma preload boundary', () => {
  const parsed = parsePreloadData({
    config: validConfig,
    publicGroupList: [],
    maintenanceList: [],
  });

  expect(parsed.config.title).toBe('Status');
  expect(parsed.publicGroupList).toEqual([]);
  expect(parsed.maintenanceList).toEqual([]);
});

test('parsePreloadData rejects preload data without publicGroupList', () => {
  expect(() =>
    parsePreloadData({
      config: validConfig,
      maintenanceList: [],
    })
  ).toThrow(ZodError);
});

test('parseSiteConfig normalizes theme values to supported UI themes', () => {
  expect(parseSiteConfig({ ...validConfig, theme: 'light' }).theme).toBe('light');
  expect(parseSiteConfig({ ...validConfig, theme: 'dark' }).theme).toBe('dark');
  expect(parseSiteConfig({ ...validConfig, theme: 'unexpected' }).theme).toBe('system');
});

test('parseVisibleIncidents keeps valid active incidents and drops malformed ones', () => {
  const parsed = parseVisibleIncidents({
    incident: {
      id: 1,
      style: 'warning',
      title: 'Maintenance',
      content: 'Planned work',
      pin: 1,
      createdDate: '2026-06-10 00:00:00',
      lastUpdatedDate: null,
    },
    incidents: [
      {
        id: 2,
        style: 'danger',
        title: 'Inactive',
        content: 'Hidden',
        pin: false,
        active: false,
        createdDate: '2026-06-10 00:00:00',
        lastUpdatedDate: null,
      },
      {
        id: 3,
        style: 'info',
        title: 'Malformed',
        content: 'No date',
        pin: false,
        lastUpdatedDate: null,
      },
    ],
  });

  expect(parsed).toHaveLength(1);
  expect(parsed[0].id).toBe(1);
  expect(parsed[0].pin).toBe(true);
  expect(parsed[0].createdDate).toBe('2026-06-10 00:00:00 +0000');
});

test('parseVisibleIncidents keeps incidents with an unknown style using the info fallback', () => {
  const parsed = parseVisibleIncidents({
    incident: {
      id: 4,
      style: 'success',
      title: 'Recovered',
      content: 'Service has recovered',
      pin: false,
      createdDate: '2026-06-10 00:00:00',
      lastUpdatedDate: null,
    },
  });

  expect(parsed).toHaveLength(1);
  expect(parsed[0].style).toBe('info');
});

test('parseGlobalConfigData keeps config when incident entries are malformed', () => {
  const parsed = parseGlobalConfigData({
    config: validConfig,
    publicGroupList: [],
    maintenanceList: [],
    incidents: [
      {
        id: 3,
        style: 'info',
        title: 'Malformed',
        content: 'No date',
        pin: false,
        lastUpdatedDate: null,
      },
    ],
  });

  expect(parsed.config.title).toBe('Status');
  expect(parsed.incidents).toBeUndefined();
});
