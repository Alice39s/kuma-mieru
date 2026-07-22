import type { GlobalConfig, Maintenance, PreloadData, SiteConfig } from '@/types/config';
import type { Incident } from '@/types/monitor';
import { z } from 'zod';
import { ensureUTCTimezone } from './time';

const timeObjectSchema = z
  .object({
    hours: z.number(),
    minutes: z.number(),
  })
  .passthrough();

const timeSlotSchema = z
  .object({
    startDate: z.string(),
    endDate: z.string(),
  })
  .passthrough();

const maintenanceSchema = z
  .object({
    id: z.number(),
    title: z.string(),
    description: z.string(),
    strategy: z.string(),
    intervalDay: z.number(),
    active: z.boolean(),
    dateRange: z.array(z.string()),
    timeRange: z.array(timeObjectSchema),
    weekdays: z.array(z.number()),
    daysOfMonth: z.array(z.number()),
    timeslotList: z.array(timeSlotSchema),
    cron: z.string(),
    durationMinutes: z.number().nullable(),
    timezone: z.string(),
    timezoneOption: z.string(),
    timezoneOffset: z.string(),
    status: z.string(),
  })
  .passthrough();

const siteConfigSchema = z
  .object({
    slug: z.string(),
    title: z.string(),
    description: z.string(),
    icon: z.string(),
    theme: z
      .string()
      .transform(theme => (theme === 'dark' ? 'dark' : theme === 'light' ? 'light' : 'system')),
    published: z.boolean(),
    showTags: z.boolean(),
    customCSS: z.string(),
    footerText: z.string(),
    showPoweredBy: z.boolean(),
    googleAnalyticsId: z.string().nullable(),
    showCertificateExpiry: z.boolean(),
  })
  .passthrough();

const monitorGroupListSchema = z.array(z.unknown());

const incidentSchema = z
  .object({
    id: z.number(),
    style: z.enum(['info', 'warning', 'danger', 'primary', 'light', 'dark']).catch('info'),
    title: z.string(),
    content: z.string(),
    pin: z.union([z.number(), z.boolean()]).transform(Boolean),
    createdDate: z.string().transform(ensureUTCTimezone),
    lastUpdatedDate: z
      .string()
      .nullable()
      .transform(value => (value ? ensureUTCTimezone(value) : null)),
    active: z.boolean().optional(),
    status_page_id: z.number().optional(),
  })
  .passthrough();

const activeIncidentSchema = incidentSchema.refine(incident => incident.active !== false);

const preloadDataSchema = z
  .object({
    config: siteConfigSchema,
    publicGroupList: monitorGroupListSchema,
    maintenanceList: z.array(maintenanceSchema).default([]),
    incident: z.unknown().optional(),
    incidents: z.unknown().optional(),
  })
  .passthrough();

const preloadIncidentSourceSchema = z.object({
  incident: z.unknown().optional(),
  incidents: z.array(z.unknown()).catch([]).default([]),
});

const incidentCandidatesSchema = preloadIncidentSourceSchema.transform(({ incident, incidents }) =>
  incident === undefined ? incidents : [incident, ...incidents]
);

export function parsePreloadData(input: unknown): PreloadData {
  return preloadDataSchema.parse(input) as PreloadData;
}

export function isPreloadData(input: unknown): input is PreloadData {
  return preloadDataSchema.safeParse(input).success;
}

export function parseSiteConfig(input: unknown): SiteConfig {
  return siteConfigSchema.parse(input) as SiteConfig;
}

export function parseMaintenanceList(input: unknown): Maintenance[] {
  return z.array(maintenanceSchema).parse(input);
}

export function parseVisibleIncidents(input: unknown): Incident[] {
  const candidates = incidentCandidatesSchema.parse(input);

  return candidates.flatMap(candidate => {
    const parsed = activeIncidentSchema.safeParse(candidate);
    return parsed.success ? [parsed.data as Incident] : [];
  });
}

export function parseGlobalConfigData(input: unknown): Pick<GlobalConfig, 'config'> & {
  maintenanceList: Maintenance[];
  incidents?: Incident[];
} {
  const preloadData = parsePreloadData(input);
  const incidents = parseVisibleIncidents(preloadData);

  return {
    config: parseSiteConfig(preloadData.config),
    maintenanceList: parseMaintenanceList(preloadData.maintenanceList),
    incidents: incidents.length > 0 ? incidents : undefined,
  };
}
