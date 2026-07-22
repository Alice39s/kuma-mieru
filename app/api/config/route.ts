import { getApiResultResponseInit, getPageIdFromRequest } from '@/app/lib/api-utils';
import { getAvailablePageIds, getConfig } from '@/config/api';
import { getGlobalConfigResult, getPageTabsMetadataResult } from '@/services/config.server';
import { buildIconProxyUrl } from '@/utils/icon-proxy';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const pageId = getPageIdFromRequest(request, getAvailablePageIds());
  const resolvedConfig = getConfig(pageId) ?? getConfig();
  const result = await getGlobalConfigResult(pageId ?? undefined);
  const tabsResult = await getPageTabsMetadataResult();
  const resolvedPageId = resolvedConfig?.pageId;

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
    getApiResultResponseInit(result.status)
  );
}
