import packageJson from '@/package.json';
import { z } from 'zod';

export const customFetchOptions = {
  headers: {
    'User-Agent': `Kuma-Mieru/${packageJson.version} (https://github.com/Alice39s/kuma-mieru)`,
    Accept: 'text/html,application/json,*/*',
    'Accept-Encoding': '', // bypass encoding
    Connection: 'keep-alive',
  },
  maxRetries: 3,
  retryDelay: 500,
  timeout: 8000,
};

const insecureTlsSchema = z
  .enum(['true', 'false'])
  .optional()
  .default('false')
  .transform(value => value === 'true');

export const allowInsecureTls = insecureTlsSchema.parse(
  process.env.ALLOW_INSECURE_TLS?.toLowerCase()
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
