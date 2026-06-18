import { z } from 'zod';

const normalizedBooleanStringSchema = z
  .string()
  .trim()
  .transform(value => value.toLowerCase());

const strictBooleanStringSchema = normalizedBooleanStringSchema
  .pipe(z.enum(['true', 'false']))
  .transform(value => value === 'true');

export const booleanEnvSchema = z.union([
  z.undefined().transform(() => false),
  strictBooleanStringSchema,
]);

export function parseBooleanEnvWithDefault(value, defaultValue) {
  return z
    .union([
      z.undefined().transform(() => defaultValue),
      normalizedBooleanStringSchema.transform(normalizedValue => normalizedValue === 'true'),
    ])
    .parse(value);
}
