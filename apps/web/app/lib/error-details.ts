export interface ParsedErrorDetails {
  kind: 'current_unavailable' | 'all_unavailable' | 'generic';
  diagnostics: string;
  statusCode?: number;
  statusMessage?: string;
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
  ] = message.split('::');
  const statusCode = Number.parseInt(statusCodeRaw, 10);

  return {
    kind: 'current_unavailable',
    diagnostics: `${diagnostics} (page: ${pageId}, reason: ${failureType})`,
    statusCode: Number.isNaN(statusCode) || statusCode <= 0 ? undefined : statusCode,
    statusMessage,
  };
}

function parseAllPagesUnavailable(message: string): ParsedErrorDetails | null {
  if (!message.startsWith('ALL_PAGES_UNAVAILABLE::')) {
    return null;
  }

  const [, statusCodeRaw = '0', statusMessage = 'Unknown', diagnostics = 'All pages unavailable'] =
    message.split('::');
  const statusCode = Number.parseInt(statusCodeRaw, 10);

  return {
    kind: 'all_unavailable',
    diagnostics,
    statusCode: Number.isNaN(statusCode) || statusCode <= 0 ? undefined : statusCode,
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

  const directHttpMatch = message.match(/\b([1-5]\d\d)\s+([A-Za-z][A-Za-z\s-]{1,})\b/);
  if (directHttpMatch?.[1]) {
    return {
      kind: 'generic',
      diagnostics: message,
      statusCode: Number.parseInt(directHttpMatch[1], 10),
      statusMessage: directHttpMatch[2]?.trim(),
    };
  }

  return {
    kind: 'generic',
    diagnostics: message,
    statusCode: undefined,
    statusMessage: undefined,
  };
}
