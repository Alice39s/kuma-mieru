import { NextResponse } from 'next/server';

interface ApiResponse {
  success: boolean;
  timestamp: number;
  error?: string;
}

interface CacheOptions {
  maxAge?: number; // in seconds
  revalidate?: number;
}

type SuccessResponse<T> = T & ApiResponse;
type ErrorResponse = ApiResponse;

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
      headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, proxy-revalidate';
      headers.Pragma = 'no-cache';
      headers.Expires = '0';
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
        error: error instanceof Error ? error.message : 'Connection Error',
        timestamp: Date.now(),
      },
      { status: 500 }
    );
  }
}
