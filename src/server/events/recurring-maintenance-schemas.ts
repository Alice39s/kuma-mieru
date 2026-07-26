import { z } from 'zod';

export const recurringMaintenancePlanStateSchema = z.enum(['active', 'paused', 'archived']);
export const recurringMaintenanceFrequencySchema = z.enum(['daily', 'weekly']);

const dateTimeSchema = z.string().datetime({ offset: true });
const affectedComponentsSchema = z.array(z.string().trim().min(1).max(200)).max(100).default([]);

const recurrenceShape = {
  timeBasis: z.literal('utc').default('utc'),
  frequency: recurringMaintenanceFrequencySchema,
  interval: z.number().int().min(1).max(52),
  weekdays: z.array(z.number().int().min(1).max(7)).max(7).default([]),
  anchorStartAt: dateTimeSchema,
  durationMinutes: z.number().int().min(1).max(10_080),
  endsAt: dateTimeSchema.nullable().default(null),
};

const validateRecurrence = (
  input: {
    frequency: z.infer<typeof recurringMaintenanceFrequencySchema>;
    weekdays: number[];
    anchorStartAt: string;
    endsAt: string | null;
    affectedComponentIds: string[];
  },
  context: z.RefinementCtx
) => {
  if (new Set(input.weekdays).size !== input.weekdays.length) {
    context.addIssue({
      code: 'custom',
      path: ['weekdays'],
      message: 'Recurring maintenance weekdays must be unique.',
    });
  }
  if (input.frequency === 'daily' && input.weekdays.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['weekdays'],
      message: 'Daily recurrence does not accept weekdays.',
    });
  }
  if (input.frequency === 'weekly' && input.weekdays.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['weekdays'],
      message: 'Weekly recurrence requires at least one UTC weekday.',
    });
  }
  if (input.endsAt && Date.parse(input.endsAt) < Date.parse(input.anchorStartAt)) {
    context.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: 'Recurring maintenance end must not precede its anchor.',
    });
  }
  if (new Set(input.affectedComponentIds).size !== input.affectedComponentIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['affectedComponentIds'],
      message: 'Affected component IDs must be unique.',
    });
  }
};

const planContentShape = {
  name: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(50_000),
  affectedComponentIds: affectedComponentsSchema,
  ...recurrenceShape,
};

export const recurringMaintenancePlanCreateSchema = z
  .object({
    pageId: z.string().trim().min(1).max(200),
    state: z.literal('active').default('active'),
    ...planContentShape,
  })
  .strict()
  .superRefine(validateRecurrence);

export const recurringMaintenancePlanUpdateSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    state: recurringMaintenancePlanStateSchema,
    ...planContentShape,
  })
  .strict()
  .superRefine(validateRecurrence);

export const recurringMaintenanceMaterializeSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export type RecurringMaintenancePlanState = z.infer<typeof recurringMaintenancePlanStateSchema>;
export type RecurringMaintenanceFrequency = z.infer<typeof recurringMaintenanceFrequencySchema>;
export type RecurringMaintenancePlanCreateInput = z.infer<
  typeof recurringMaintenancePlanCreateSchema
>;
export type RecurringMaintenancePlanUpdateInput = z.infer<
  typeof recurringMaintenancePlanUpdateSchema
>;
