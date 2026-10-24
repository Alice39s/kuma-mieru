import { customFetchOptions } from './common';
import { customFetch } from './fetch';

/**
 * 通用API数据错误类
 */
export class ApiDataError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly endpoint?: string
  ) {
    super(message);
    this.name = 'ApiDataError';
  }
}

/**
 * 通用API数据获取函数
 * @param endpoint - API端点
 * @param options - 请求选项
 * @returns API响应数据
 */
export async function fetchApiData<T>(
  endpoint: string,
  options: RequestInit = customFetchOptions
): Promise<T> {
  try {
    const apiResponse = await customFetch(endpoint, options);

    if (!apiResponse.ok) {
      throw new ApiDataError(
        `API request failed: ${apiResponse.status} ${apiResponse.statusText}`,
        undefined,
        endpoint
      );
    }

    try {
      return (await apiResponse.json()) as T;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ApiDataError('API data JSON parsing failed', error, endpoint);
      }
      throw new ApiDataError('API data parsing failed', error, endpoint);
    }
  } catch (error) {
    if (error instanceof ApiDataError) {
      throw error;
    }
    throw new ApiDataError(
      `Failed to fetch data from API: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error,
      endpoint
    );
  }
}

/**
 * 通用错误日志函数
 * @param context - 错误上下文描述
 * @param error - 错误对象
 * @param additionalInfo - 附加信息
 */
export function logApiError(
  context: string,
  error: unknown,
  additionalInfo?: Record<string, unknown>
): void {
  console.error(
    `Failed to ${context}:`,
    error instanceof ApiDataError ? error.message : 'Unknown error',
    {
      ...additionalInfo,
      error:
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack,
              cause: error.cause,
            }
          : error,
      endpoint: error instanceof ApiDataError ? error.endpoint : undefined,
    }
  );
}

/**
 * 通用API服务接口
 */
export interface ApiService<T, R> {
  fetchData(): Promise<R>;
  processData(data: T): R;
  handleError(error: unknown): R;
}
