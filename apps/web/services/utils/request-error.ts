import type { PageFailureType } from '@/types/page';

interface ErrorWithCode extends Error {
  code?: string;
  cause?: unknown;
}

export interface HttpStatusDetails {
  statusCode?: number;
  statusMessage?: string;
}

export function extractHttpStatusDetails(error: unknown): HttpStatusDetails {
  const getErrorChain = (input: unknown): ErrorWithCode[] => {
    const chain: ErrorWithCode[] = [];
    let current = input;

    for (let i = 0; i < 4; i += 1) {
      if (!(current instanceof Error)) {
        break;
      }

      chain.push(current as ErrorWithCode);
      current = (current as ErrorWithCode).cause;
    }

    return chain;
  };

  const errorChain = getErrorChain(error);
  const message =
    errorChain.map(item => item.message).find(item => item && item.length > 0) ??
    String(error ?? '');

  const directMatch = message.match(/\b([1-5]\d\d)\s+([A-Za-z][A-Za-z\s-]{1,})\b/);

  if (directMatch?.[1]) {
    const statusCode = Number.parseInt(directMatch[1], 10);
    const statusMessage = directMatch[2]?.trim();
    return {
      statusCode,
      statusMessage: statusMessage && statusMessage.length > 0 ? statusMessage : undefined,
    };
  }

  const errorCode = errorChain
    .map(item => (typeof item.code === 'string' ? item.code.toUpperCase() : undefined))
    .find(code => typeof code === 'string' && code.length > 0);

  if (errorCode) {
    return {
      statusCode: undefined,
      statusMessage: `NO_HTTP_RESPONSE (${errorCode})`,
    };
  }

  return {
    statusCode: undefined,
    statusMessage: undefined,
  };
}

export function classifyRequestError(error: unknown): PageFailureType {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as ErrorWithCode).code ?? '').toUpperCase()
      : '';

  if (code === 'ETIMEDOUT' || message.includes('timeout') || message.includes('timed out')) {
    return 'timeout';
  }

  if (code === 'ECONNRESET' || message.includes('econnreset') || message.includes('network')) {
    return 'network_reset';
  }

  if (message.includes('json') || message.includes('parse')) {
    return 'parse_error';
  }

  const httpStatusMatch = message.match(/\b(\d{3})\b/);
  if (httpStatusMatch?.[1]) {
    const status = Number.parseInt(httpStatusMatch[1], 10);
    if (status >= 400 && status < 500) {
      return 'http_4xx';
    }
    if (status >= 500) {
      return 'http_5xx';
    }
  }

  return 'unknown';
}
