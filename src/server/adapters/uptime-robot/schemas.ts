import { z } from 'zod';

const monitorTagSchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string().min(1),
  color: z.string().min(1),
});

export const uptimeRobotMonitorSchema = z
  .object({
    id: z.number().int().nonnegative(),
    friendlyName: z.string().min(1),
    status: z.string(),
    url: z.string(),
    groupId: z.number().int().nonnegative().nullable().optional(),
    tags: z.array(monitorTagSchema),
    lastDayUptimes: z.object({
      bucketSize: z.number().positive(),
      histogram: z.array(
        z.object({
          timestamp: z.number(),
          uptime: z.number().nonnegative(),
          changes: z.number().int().nonnegative().optional(),
        })
      ),
    }),
  })
  .passthrough();

export const uptimeRobotMonitorPageSchema = z.object({
  nextLink: z.string().nullable(),
  data: z.array(uptimeRobotMonitorSchema),
});

export const uptimeRobotGroupPageSchema = z.object({
  nextLink: z.string().nullable(),
  data: z.array(
    z
      .object({
        id: z.number().int().nonnegative(),
        name: z.string().min(1),
      })
      .passthrough()
  ),
});

export type UptimeRobotMonitorPage = z.infer<typeof uptimeRobotMonitorPageSchema>;
export type UptimeRobotGroupPage = z.infer<typeof uptimeRobotGroupPageSchema>;
