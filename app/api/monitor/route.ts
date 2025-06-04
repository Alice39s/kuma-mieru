import { createApiResponse } from '@/app/lib/api-utils';
import { getConfigForPage } from '@/config/api';
import { getMonitoringData } from '@/services/monitor.server';
import type { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const pageId = request.nextUrl.searchParams.get('pageId');

  return createApiResponse(
    async () => {
      const config = pageId ? getConfigForPage(pageId) : undefined;
      return getMonitoringData(config);
    },
    {
      maxAge: 60, // Cache for 1 minute
      revalidate: 30,
    },
  );
}
