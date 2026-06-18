import { booleanEnvSchema } from '@/utils/boolean-schema';
import { extractHttpStatusDetailsFromMessage, parseHttpStatusCode } from '@/utils/http-status';

export interface ParsedErrorDetails {
  kind: 'current_unavailable' | 'all_unavailable' | 'generic';
  diagnostics: string;
  statusCode?: number;
  statusMessage?: string;
}

export interface ErrorPageDevDetailsOptions {
  publicDevMode: string | undefined;
  nodeEnv: string | undefined;
}

function splitErrorPayload(message: string, fieldCount: number): string[] {
  const fields: string[] = [];
  let remainder = message;

  for (let index = 0; index < fieldCount - 1; index += 1) {
    const separatorIndex = remainder.indexOf('::');

    if (separatorIndex === -1) {
      fields.push(remainder);
      remainder = '';
      continue;
    }

    fields.push(remainder.slice(0, separatorIndex));
    remainder = remainder.slice(separatorIndex + 2);
  }

  fields.push(remainder);
  return fields;
}

function parseCurrentPageUnavailable(message: string): ParsedErrorDetails | null {
  if (!message.startsWith('CURRENT_PAGE_UNAVAILABLE::')) {
    return null;
  }

  const [
    ,
    pageId = '',
    failureType = 'unknown',
    statusCodeRaw = '0',
    statusMessage = 'Unknown',
    diagnostics = 'Unknown error',
  ] = splitErrorPayload(message, 6);
  const statusCode = parseHttpStatusCode(statusCodeRaw);

  return {
    kind: 'current_unavailable',
    diagnostics: `${diagnostics} (page: ${pageId}, reason: ${failureType})`,
    statusCode,
    statusMessage,
  };
}

function parseAllPagesUnavailable(message: string): ParsedErrorDetails | null {
  if (!message.startsWith('ALL_PAGES_UNAVAILABLE::')) {
    return null;
  }

  const [, statusCodeRaw = '0', statusMessage = 'Unknown', diagnostics = 'All pages unavailable'] =
    splitErrorPayload(message, 4);
  const statusCode = parseHttpStatusCode(statusCodeRaw);

  return {
    kind: 'all_unavailable',
    diagnostics,
    statusCode,
    statusMessage,
  };
}

export function parseErrorDetails(message: string): ParsedErrorDetails {
  const currentPage = parseCurrentPageUnavailable(message);
  if (currentPage) {
    return currentPage;
  }

  const allPages = parseAllPagesUnavailable(message);
  if (allPages) {
    return allPages;
  }

  const directHttpDetails = extractHttpStatusDetailsFromMessage(message);
  if (directHttpDetails) {
    return {
      kind: 'generic',
      diagnostics: message,
      ...directHttpDetails,
    };
  }

  return {
    kind: 'generic',
    diagnostics: message,
    statusCode: undefined,
    statusMessage: undefined,
  };
}

export function shouldShowErrorPageDevDetails({
  publicDevMode,
  nodeEnv,
}: ErrorPageDevDetailsOptions) {
  if (nodeEnv === 'development') {
    return true;
  }

  const parsedPublicDevMode = booleanEnvSchema.safeParse(publicDevMode);
  return parsedPublicDevMode.success ? parsedPublicDevMode.data : false;
}
