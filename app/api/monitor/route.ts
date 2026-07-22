import { getApiResultResponseInit, getPageIdFromRequest } from '@/app/lib/api-utils';
import { getAvailablePageIds } from '@/config/api';
import { getMonitoringDataResult } from '@/services/monitor.server';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const pageId = getPageIdFromRequest(request, getAvailablePageIds());
  const result = await getMonitoringDataResult(pageId ?? undefined);

  return NextResponse.json(
    {
      ...result.data,
      success: result.success,
      status: result.status,
      failureType: result.failureType,
      error: result.error,
      timestamp: Date.now(),
    },
    getApiResultResponseInit(result.status)
  );
}
