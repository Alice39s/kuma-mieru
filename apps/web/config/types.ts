import type { InferOutput } from 'valibot';
import type { generatedConfigSchema, generatedPageConfigSchema } from './schemas';

export type GeneratedPageConfig = InferOutput<typeof generatedPageConfigSchema>;

export type GeneratedConfig = InferOutput<typeof generatedConfigSchema>;
