import type { OutgoingHttpHeaders } from 'node:http';
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { customFetchOptions } from './common';

interface CustomResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}

interface NodeError extends Error {
  code?: string;
}

interface RetryOptions {
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
  followRedirects?: boolean;
  maxRedirects?: number;
}

const DEFAULT_RETRY_OPTIONS: Required<Omit<RetryOptions, 'followRedirects' | 'maxRedirects'>> = {
  maxRetries: 3,
  retryDelay: 1000,
  timeout: 10000,
};

const DEFAULT_FOLLOW_REDIRECTS = true;
const DEFAULT_MAX_REDIRECTS = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function makeRequest(
  url: string,
  options: RequestInit & RetryOptions = {},
  retryCount = 0,
  redirectCount = 0,
): Promise<CustomResponse> {
  const {
    maxRetries = DEFAULT_RETRY_OPTIONS.maxRetries,
    retryDelay = DEFAULT_RETRY_OPTIONS.retryDelay,
    timeout = DEFAULT_RETRY_OPTIONS.timeout,
    followRedirects = DEFAULT_FOLLOW_REDIRECTS,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    ...fetchOptions
  } = options;

  const mergedOptions = {
    ...customFetchOptions,
    ...fetchOptions,
  };

  const parsedUrl = new URL(url);
  const protocol = parsedUrl.protocol === 'https:' ? https : http;

  // Preserve original header case for Cloudflare Access
  const headers: OutgoingHttpHeaders = {};
  if (mergedOptions.headers) {
    for (const [key, value] of Object.entries(mergedOptions.headers)) {
      // Keep original case for Cloudflare Access headers
      if (key.toLowerCase().startsWith('cf-access-')) {
        headers[key] = value;
      } else {
        headers[key.toLowerCase()] = value;
      }
    }
  }

  const isDevelopment = process.env.NODE_ENV === 'development';

  // Debug logging for Cloudflare Access headers
  if (headers['CF-Access-Client-Id'] || headers['cf-access-client-id']) {
    console.log('Sending Cloudflare Access headers for request:', {
      url,
      hasClientId: !!(headers['CF-Access-Client-Id'] || headers['cf-access-client-id']),
      hasClientSecret: !!(headers['CF-Access-Client-Secret'] || headers['cf-access-client-secret']),
      headers: Object.keys(headers).filter((key) => key.toLowerCase().includes('cf-access')),
    });
  }

  return new Promise((resolve, reject) => {
    const req = protocol.request(
      url,
      {
        method: mergedOptions.method || 'GET',
        headers,
        timeout,
        rejectUnauthorized: isDevelopment,
        minVersion: 'TLSv1.2',
        maxVersion: 'TLSv1.3',
        ciphers: 'HIGH:!aNULL:!MD5',
      },
      async (res) => {
        let responseBody = '';

        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          responseBody += chunk;
        });

        res.on('end', async () => {
          // Handle redirects
          if (followRedirects && [301, 302, 303, 307, 308].includes(res.statusCode || 0)) {
            const location = res.headers.location;
            if (location && redirectCount < maxRedirects) {
              console.log(
                `Following redirect (${redirectCount + 1}/${maxRedirects}): ${url} -> ${location}`,
              );

              // Close current request
              req.destroy();

              // Follow redirect
              try {
                const redirectUrl = new URL(location, url).toString();
                const redirectResponse = await makeRequest(
                  redirectUrl,
                  options,
                  retryCount,
                  redirectCount + 1,
                );
                resolve(redirectResponse);
              } catch (error) {
                reject(error);
              }
              return;
            }

            if (redirectCount >= maxRedirects) {
              console.warn(`Max redirects (${maxRedirects}) exceeded for: ${url}`);
            }
          }

          const response: CustomResponse = {
            ok: res.statusCode ? res.statusCode >= 200 && res.statusCode < 300 : false,
            status: res.statusCode || 0,
            statusText: res.statusMessage || '',
            headers: Object.fromEntries(
              Object.entries(res.headers).map(([key, value]) => [
                key,
                Array.isArray(value) ? value.join(', ') : value || '',
              ]),
            ),
            text: async () => responseBody,
            json: async () => {
              try {
                return JSON.parse(responseBody);
              } catch (error) {
                throw new Error(
                  `Failed to parse JSON: ${error instanceof Error ? error.message : 'Unknown error'}`,
                );
              }
            },
          };

          resolve(response);
        });
      },
    );

    req.on('error', async (error: NodeError) => {
      const shouldRetry =
        retryCount < maxRetries &&
        (error.code === 'ECONNRESET' ||
          error.code === 'ETIMEDOUT' ||
          error.code === 'ECONNREFUSED' ||
          error.code === 'EHOSTUNREACH');

      if (shouldRetry) {
        console.warn(`请求失败，正在重试 (${retryCount + 1}/${maxRetries}):`, {
          url,
          error: {
            name: error.name,
            message: error.message,
            code: error.code,
          },
        });

        try {
          await sleep(retryDelay * (retryCount + 1));
          const response = await makeRequest(url, options, retryCount + 1, redirectCount);
          resolve(response);
        } catch (retryError) {
          reject(retryError);
        }
      } else {
        console.error('请求错误:', {
          url,
          error: {
            name: error.name,
            message: error.message,
            code: error.code,
            stack: error.stack,
          },
        });
        reject(error);
      }
    });

    req.on('timeout', () => {
      req.destroy();
      const error = new Error('请求超时');
      (error as NodeError).code = 'ETIMEDOUT';
      req.emit('error', error);
    });

    if (mergedOptions.body) {
      req.write(mergedOptions.body);
    }

    req.end();
  });
}

export async function customFetch(
  url: string,
  options: RequestInit & RetryOptions = {},
): Promise<CustomResponse> {
  return makeRequest(url, options);
}
