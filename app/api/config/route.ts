import { createApiResponse } from '@/app/lib/api-utils';
import { getConfigForPage } from '@/config/api';
import { getGlobalConfig } from '@/services/config.server';
import type { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const pageId = request.nextUrl.searchParams.get('pageId');

  return createApiResponse(
    async () => {
      const config = pageId ? getConfigForPage(pageId) : undefined;
      return getGlobalConfig(config);
    },
    {
      maxAge: 60,
      revalidate: 30,
    },
  );
}
