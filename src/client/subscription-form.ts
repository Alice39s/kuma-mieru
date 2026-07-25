import { z } from 'zod';

export const publicSubscriptionFormSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(320),
  componentIds: z.array(z.string().min(1).max(200)).max(100).default([]),
  website: z.string().max(500).default(''),
});

export type PublicSubscriptionFormInput = z.input<typeof publicSubscriptionFormSchema>;
export type PublicSubscriptionFormValue = z.output<typeof publicSubscriptionFormSchema>;

export const normalizePublicSubscriptionInput = (input: PublicSubscriptionFormInput) => {
  const value = publicSubscriptionFormSchema.parse(input);
  return {
    email: value.email,
    componentIds: [...new Set(value.componentIds)].sort(),
    ...(value.website ? { website: value.website } : {}),
  };
};

export const subscriptionScopeSchema = z
  .object({
    scope: z.enum(['page', 'components', 'incident']),
    componentIds: z.array(z.string().min(1).max(200)).max(100).default([]),
  })
  .superRefine((input, context) => {
    if (input.scope === 'components' && input.componentIds.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['componentIds'],
        message: 'Choose at least one component.',
      });
    }
  });

export type SubscriptionScopeInput = z.input<typeof subscriptionScopeSchema>;
export type SubscriptionScopeValue = z.output<typeof subscriptionScopeSchema>;
