import packageJson from '@/package.json';
import {
  integer,
  maxValue,
  minValue,
  number,
  object,
  optional,
  parse,
  picklist,
  pipe,
  string,
  transform,
} from 'valibot';

export function envIntWithDefault(name: string, defaultValue: number, min: number, max: number) {
  const message = `${name} must be an integer between ${min} and ${max}`;

  return pipe(
    optional(string(message), ''),
    transform(value => (value === '' ? defaultValue : Number(value))),
    number(message),
    integer(message),
    minValue(min, message),
    maxValue(max, message)
  );
}

export function envFlag(name: string) {
  return pipe(
    optional(picklist(['true', 'false'], `${name} must be "true" or "false"`), 'false'),
    transform(value => value === 'true')
  );
}

const requestPolicySchema = object({
  maxRetries: envIntWithDefault('REQUEST_RETRY_MAX', 3, 0, 10),
  retryDelay: envIntWithDefault('REQUEST_RETRY_DELAY_MS', 500, 100, 10000),
  timeout: envIntWithDefault('REQUEST_TIMEOUT_MS', 8000, 1000, 60000),
});

const requestPolicy = parse(requestPolicySchema, {
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

export const allowInsecureTls = parse(
  envFlag('ALLOW_INSECURE_TLS'),
  process.env.ALLOW_INSECURE_TLS?.toLowerCase()
);

export const isSsrStrictMode = parse(
  envFlag('SSR_STRICT_MODE'),
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
