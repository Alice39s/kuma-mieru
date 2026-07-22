import 'server-only';

import type { PageFailureType } from '@/types/page';
import {
  extractHttpStatusCodeFromMessage,
  extractHttpStatusDetailsFromMessage,
} from '@/utils/http-status';
import { z } from 'zod';

export interface HttpStatusDetails {
  statusCode?: number;
  statusMessage?: string;
}

const requestErrorLikeSchema = z
  .object({
    message: z.string().optional(),
    code: z.string().optional(),
    cause: z.unknown().optional(),
  })
  .passthrough();

const errorMessagesSchema = z
  .array(z.string().trim().min(1).catch(''))
  .transform(messages => messages.filter(Boolean));
type RequestErrorLike = z.infer<typeof requestErrorLikeSchema>;

function getRequestErrorChain(input: unknown): RequestErrorLike[] {
  const chain: RequestErrorLike[] = [];
  let current = input;

  for (let i = 0; i < 4; i += 1) {
    const parsed = requestErrorLikeSchema.safeParse(current);
    if (!parsed.success) {
      break;
    }

    const entry = parsed.data;
    if (!entry.message && !entry.code && entry.cause === undefined) {
      break;
    }

    chain.push(entry);
    current = entry.cause;
  }

  return chain;
}

function getErrorMessages(errorChain: RequestErrorLike[]): string[] {
  return errorMessagesSchema.parse(errorChain.map(item => item.message));
}

function getErrorCode(errorChain: RequestErrorLike[]): string {
  return (
    errorChain.map(item => item.code?.trim().toUpperCase()).find(code => code && code.length > 0) ??
    ''
  );
}

export function extractHttpStatusDetails(error: unknown): HttpStatusDetails {
  const errorChain = getRequestErrorChain(error);
  const message = getErrorMessages(errorChain).join(' ') || String(error ?? '');

  const directStatusDetails = extractHttpStatusDetailsFromMessage(message);
  if (directStatusDetails) {
    return directStatusDetails;
  }

  const errorCode = getErrorCode(errorChain);

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
  const errorChain = getRequestErrorChain(error);
  const message = getErrorMessages(errorChain).join(' ').toLowerCase();
  const code = getErrorCode(errorChain);

  if (code === 'ETIMEDOUT' || message.includes('timeout') || message.includes('timed out')) {
    return 'timeout';
  }

  if (code === 'ECONNRESET' || message.includes('econnreset') || message.includes('network')) {
    return 'network_reset';
  }

  if (message.includes('json') || message.includes('parse')) {
    return 'parse_error';
  }

  const status = extractHttpStatusCodeFromMessage(message);
  if (status !== undefined) {
    if (status >= 400 && status < 500) {
      return 'http_4xx';
    }
    if (status >= 500) {
      return 'http_5xx';
    }
  }

  return 'unknown';
}
