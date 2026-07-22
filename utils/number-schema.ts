import { z } from 'zod';

export interface IntegerStringSchemaOptions {
  min?: number;
  max?: number;
}

export function createIntegerStringSchema({ min, max }: IntegerStringSchemaOptions = {}) {
  let numberSchema = z.number().int().safe();
  if (min !== undefined) {
    numberSchema = numberSchema.min(min);
  }
  if (max !== undefined) {
    numberSchema = numberSchema.max(max);
  }

  return z
    .string()
    .trim()
    .regex(/^\d+$/)
    .transform(value => z.coerce.number().parse(value))
    .pipe(numberSchema);
}
