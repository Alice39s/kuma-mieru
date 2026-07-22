import type { Context } from 'hono';

export type AppEnvironment = { Variables: { requestId: string } };
export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 415 | 500 | 503;

export const errorResponse = (
  context: Context<AppEnvironment>,
  status: ErrorStatus,
  code: string,
  message: string,
  details?: unknown
) =>
  context.json(
    {
      error: {
        code,
        message,
        requestId: context.get('requestId'),
        ...(details === undefined ? {} : { details }),
      },
    },
    status
  );
