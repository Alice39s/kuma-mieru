/**
 * JSON 数据清理和验证工具
 */

import type { PreloadData } from '../types/config';
import { isPreloadData } from './preload-data-schema';

/**
 * 清理 JSON 字符串
 */
export function sanitizeJsonString(jsonStr: string): string {
  // 移除可能的 JavaScript 变量声明
  const cleanedStr = jsonStr.replace(/^\s*window\.preloadData\s*=\s*/, '').replace(/;?\s*$/, '');

  try {
    // 尝试直接返回字符串，不进行额外的 JSON.stringify
    return cleanedStr;
  } catch (error) {
    console.warn('JSON 字符串预处理失败:', error);
    throw error;
  }
}

/**
 * 验证预加载的数据类型
 */
export function validatePreloadData(data: unknown): data is PreloadData {
  return isPreloadData(data);
}
