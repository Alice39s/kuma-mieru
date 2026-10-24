import { createApiResponse } from '@/app/lib/api-utils';

export async function GET() {
  // Directly return, dont need to cache
  return createApiResponse(async () => ({
    status: 'ok',
    uptime: process.uptime(),
  }));
}
