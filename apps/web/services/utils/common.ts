import packageJson from '@/package.json';
import { z } from 'zod';

function envIntWithDefault(defaultValue: number, min: number, max: number) {
  return z.preprocess(value => {
    if (value === undefined || value === null || value === '') {
      return defaultValue;
    }
    return Number(value);
  }, z.number().int().min(min).max(max));
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

const insecureTlsSchema = z
  .enum(['true', 'false'])
  .optional()
  .default('false')
  .transform(value => value === 'true');

export const allowInsecureTls = insecureTlsSchema.parse(
  process.env.ALLOW_INSECURE_TLS?.toLowerCase()
);

const ssrStrictModeSchema = z
  .enum(['true', 'false'])
  .optional()
  .default('false')
  .transform(value => value === 'true');

export const isSsrStrictMode = ssrStrictModeSchema.parse(
  process.env.SSR_STRICT_MODE?.toLowerCase()
);

/**
 * Add UTC+0000 timezone to ISO date string if absent,
 * try resolving Uptime Kuma timezone offset...
 * @param dateStr - ISO date string
 * @returns date string with UTC+0000 timezone
 */
export function ensureUTCTimezone(dateStr: string): string {
  if (!dateStr) return dateStr;
  if (dateStr.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(dateStr)) {
    return dateStr.replace('Z', ' +0000').replace(/([+-]\d{2}):(\d{2})$/, '$1$2');
  }
  return `${dateStr} +0000`;
}
