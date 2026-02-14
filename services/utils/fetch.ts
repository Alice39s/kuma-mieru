import http from 'node:http';
import type { OutgoingHttpHeaders } from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { allowInsecureTls, customFetchOptions } from './common';

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
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  retryDelay: 1000,
  timeout: 10000,
};

let hasShownInsecureTlsWarning = false;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function makeRequest(
  url: string,
  options: RequestInit & RetryOptions = {},
  retryCount = 0
): Promise<CustomResponse> {
  const {
    maxRetries = DEFAULT_RETRY_OPTIONS.maxRetries,
    retryDelay = DEFAULT_RETRY_OPTIONS.retryDelay,
    timeout = DEFAULT_RETRY_OPTIONS.timeout,
    ...fetchOptions
  } = options;

  const mergedOptions = {
    ...customFetchOptions,
    ...fetchOptions,
  };

  const parsedUrl = new URL(url);
  const protocol = parsedUrl.protocol === 'https:' ? https : http;

  const headers: OutgoingHttpHeaders = {};
  if (mergedOptions.headers) {
    for (const [key, value] of Object.entries(mergedOptions.headers)) {
      headers[key.toLowerCase()] = value;
    }
  }

  return new Promise((resolve, reject) => {
    const isHttps = parsedUrl.protocol === 'https:';

    if (isHttps && allowInsecureTls && !hasShownInsecureTlsWarning) {
      hasShownInsecureTlsWarning = true;
      console.warn(
        'ALLOW_INSECURE_TLS=true: TLS certificate verification is disabled for HTTPS requests.'
      );
    }

    const req = protocol.request(
      url,
      {
        method: mergedOptions.method || 'GET',
        headers,
        timeout,
        ...(isHttps
          ? {
              rejectUnauthorized: !allowInsecureTls,
              minVersion: 'TLSv1.2' as const,
              maxVersion: 'TLSv1.3' as const,
              ciphers: 'HIGH:!aNULL:!MD5',
            }
          : {}),
      },
      res => {
        let responseBody = '';

        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          responseBody += chunk;
        });

        res.on('end', () => {
          const response: CustomResponse = {
            ok: res.statusCode ? res.statusCode >= 200 && res.statusCode < 300 : false,
            status: res.statusCode || 0,
            statusText: res.statusMessage || '',
            headers: Object.fromEntries(
              Object.entries(res.headers).map(([key, value]) => [
                key,
                Array.isArray(value) ? value.join(', ') : value || '',
              ])
            ),
            text: async () => responseBody,
            json: async () => JSON.parse(responseBody),
          };

          resolve(response);
        });
      }
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
          const response = await makeRequest(url, options, retryCount + 1);
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
  options: RequestInit & RetryOptions = {}
): Promise<CustomResponse> {
  return makeRequest(url, options);
}
