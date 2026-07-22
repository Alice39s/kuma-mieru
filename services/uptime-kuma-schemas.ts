import type { HeartbeatData, MonitorGroup, MonitoringData, UptimeData } from '@/types/monitor';
import { z } from 'zod';

const heartbeatSchema = z.object({
  status: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).catch(0),
  time: z.string(),
  msg: z.string().default(''),
  ping: z.number().nullable(),
});

const monitorTagSchema = z.object({
  id: z.number(),
  monitor_id: z.number(),
  tag_id: z.number(),
  name: z.string(),
  value: z.string().optional(),
  color: z.string(),
});

const monitorSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    sendUrl: z.number(),
    type: z.string(),
    url: z.string().optional(),
    certExpiryDaysRemaining: z.number().optional(),
    validCert: z.boolean().optional(),
    tags: z.array(monitorTagSchema).optional(),
  })
  .passthrough();

const monitorGroupSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    weight: z.number(),
    monitorList: z.array(monitorSchema),
  })
  .passthrough();

const heartbeatDataSchema = z.record(z.string(), z.array(heartbeatSchema));
const uptimeDataSchema = z.record(z.string(), z.number());

const monitoringPayloadSchema = z.object({
  heartbeatList: heartbeatDataSchema,
  uptimeList: uptimeDataSchema,
});

export function parseMonitorGroups(input: unknown): MonitorGroup[] {
  return z.array(monitorGroupSchema).parse(input) as MonitorGroup[];
}

export function parseHeartbeatData(input: unknown): HeartbeatData {
  return heartbeatDataSchema.parse(input) as HeartbeatData;
}

export function parseUptimeData(input: unknown): UptimeData {
  return uptimeDataSchema.parse(input) as UptimeData;
}

export function parseMonitoringPayload(input: unknown): MonitoringData {
  return monitoringPayloadSchema.parse(input) as MonitoringData;
}
