import packageJson from '@/package.json';
import { booleanEnvSchema } from '@/utils/boolean-schema';
import { z } from 'zod';

function envIntWithDefault(defaultValue: number, min: number, max: number) {
  const emptyValueSchema = z
    .union([z.undefined(), z.null(), z.string().trim().length(0)])
    .transform(() => defaultValue);
  const integerValueSchema = z.coerce.number().pipe(z.number().int().min(min).max(max));

  return z.union([emptyValueSchema, integerValueSchema]);
}

const requestPolicySchema = z.object({
  maxRetries: envIntWithDefault(3, 0, 10),
  retryDelay: envIntWithDefault(500, 100, 10000),
  timeout: envIntWithDefault(8000, 1000, 60000),
});

const requestPolicy = requestPolicySchema.parse({
  maxRetries: process.env.REQUEST_RETRY_MAX,
  retryDelay: process.env.REQUEST_RETRY_DELAY_MS,
  timeout: process.env.REQUEST_TIMEOUT_MS,
});

export const customFetchOptions = {
  headers: {
    'User-Agent': `Kuma-Mieru/${packageJson.version} (https://github.com/Alice39s/kuma-mieru)`,
    Accept: 'text/html,application/json,*/*',
    'Accept-Encoding': '', // bypass encoding
    Connection: 'keep-alive',
  },
  maxRetries: requestPolicy.maxRetries,
  retryDelay: requestPolicy.retryDelay,
  timeout: requestPolicy.timeout,
};

export const allowInsecureTls = booleanEnvSchema.parse(process.env.ALLOW_INSECURE_TLS);

export const isSsrStrictMode = booleanEnvSchema.parse(process.env.SSR_STRICT_MODE);
