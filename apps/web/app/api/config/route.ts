import { getConfig } from '@/config/api';
import { getGlobalConfigResult, getPageTabsMetadataResult } from '@/services/config.server';
import { buildIconProxyUrl } from '@/utils/icon-proxy';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const pageId = searchParams.get('pageId') ?? undefined;
  const resolvedConfig = getConfig(pageId) ?? getConfig();
  const result = await getGlobalConfigResult(pageId ?? undefined);
  const tabsResult = await getPageTabsMetadataResult();
  const resolvedPageId = resolvedConfig?.pageId;
  const isAllFailed = result.status === 'all_failed';

  const headers: Record<string, string> = isAllFailed
    ? {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      }
    : {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30',
      };

  return NextResponse.json(
    {
      ...result.data,
      config: {
        ...result.data.config,
        icon: buildIconProxyUrl(resolvedPageId),
      },
      success: result.success,
      status: result.status,
      pageTabs: tabsResult.tabs,
      matrixStatus: tabsResult.matrix.status,
      failureType: result.failureType,
      error: result.error,
      timestamp: Date.now(),
    },
    {
      status: isAllFailed ? 503 : 200,
      headers,
    }
  );
}
