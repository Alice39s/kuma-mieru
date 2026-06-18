import { NextResponse } from 'next/server';
import { z } from 'zod';

interface ApiResponse {
  success: boolean;
  timestamp: number;
  error?: string;
}

interface CacheOptions {
  maxAge?: number; // in seconds
  revalidate?: number;
}

type UpstreamResultStatus = 'ok' | 'partial_failed' | 'all_failed';

type SuccessResponse<T> = T & ApiResponse;
type ErrorResponse = ApiResponse;

interface ApiResultResponseInit {
  status: 200 | 503;
  headers: Record<string, string>;
}

const pageIdSearchParamSchema = z.string().trim().min(1);

const createPageIdSearchParamSchema = (availablePageIds?: readonly string[]) => {
  if (!availablePageIds) {
    return pageIdSearchParamSchema;
  }

  return pageIdSearchParamSchema.refine(pageId => availablePageIds.includes(pageId));
};

export function getNoStoreHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  };
}

export function getShortCacheHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30',
  };
}

export function getApiResultHeaders(status: UpstreamResultStatus): Record<string, string> {
  return status === 'all_failed' ? getNoStoreHeaders() : getShortCacheHeaders();
}

export function getApiResultResponseInit(status: UpstreamResultStatus): ApiResultResponseInit {
  return {
    status: status === 'all_failed' ? 503 : 200,
    headers: getApiResultHeaders(status),
  };
}

export function getPageIdFromRequest(
  request: Request,
  availablePageIds?: readonly string[]
): string | undefined {
  const { searchParams } = new URL(request.url);
  const parsed = createPageIdSearchParamSchema(availablePageIds).safeParse(
    searchParams.get('pageId')
  );

  return parsed.success ? parsed.data : undefined;
}

export async function createApiResponse<T>(
  handler: () => Promise<T>,
  options: CacheOptions = {}
): Promise<NextResponse<SuccessResponse<T> | ErrorResponse>> {
  try {
    const data = await handler();

    const headers: Record<string, string> = {};
    if (options.maxAge) {
      headers['Cache-Control'] = `public, s-maxage=${options.maxAge}, stale-while-revalidate=${
        options.revalidate || options.maxAge
      }`;
    } else {
      Object.assign(headers, getNoStoreHeaders());
    }

    return NextResponse.json(
      {
        ...data,
        success: true,
        timestamp: Date.now(),
      },
      {
        status: 200,
        headers,
      }
    );
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal Server Error',
        timestamp: Date.now(),
      },
      { status: 500, headers: getNoStoreHeaders() }
    );
  }
}
