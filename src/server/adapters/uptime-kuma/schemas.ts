import { z } from 'zod';

const monitorTagSchema = z
  .object({
    name: z.string(),
    value: z.string().optional(),
    color: z.string().default('#64748b'),
  })
  .passthrough();

const monitorSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    name: z.string(),
    tags: z.array(monitorTagSchema).optional().default([]),
  })
  .passthrough();

const monitorGroupSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    name: z.string(),
    weight: z.number().optional().default(0),
    monitorList: z.array(monitorSchema),
  })
  .passthrough();

export const uptimeKumaIncidentSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    style: z.string().optional().default('unknown'),
    title: z.string(),
    content: z.string().optional().default(''),
    createdDate: z.string().nullable().optional().default(null),
    lastUpdatedDate: z.string().nullable().optional().default(null),
  })
  .passthrough();

export const uptimeKumaPageSchema = z
  .object({
    config: z
      .object({
        title: z.string().optional().default('Uptime Kuma'),
        description: z.string().optional().default(''),
        icon: z.string().max(2_048).optional(),
      })
      .passthrough(),
    publicGroupList: z.array(monitorGroupSchema),
    incident: uptimeKumaIncidentSchema.nullable().optional(),
    incidents: z.array(uptimeKumaIncidentSchema).optional(),
    maintenanceList: z.array(z.unknown()).optional().default([]),
  })
  .passthrough();

const heartbeatSchema = z
  .object({
    status: z.number().int(),
    time: z.string(),
    ping: z.number().nullable().optional().default(null),
  })
  .passthrough();

export const uptimeKumaHeartbeatSchema = z
  .object({
    heartbeatList: z.record(z.string(), z.array(heartbeatSchema)),
    uptimeList: z.record(z.string(), z.number()),
  })
  .passthrough();

export type UptimeKumaPage = z.infer<typeof uptimeKumaPageSchema>;
export type UptimeKumaHeartbeat = z.infer<typeof uptimeKumaHeartbeatSchema>;
