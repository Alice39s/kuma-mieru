import { z } from 'zod';
import { decodeHtmlEntities, decodeHtmlEntityCodePoint } from './html-entities';

const decodeStringSchema = z.string();
const decodeArraySchema = z.array(z.unknown());
const decodeRecordSchema = z.record(z.string(), z.unknown());

function decodeStringValue(value: string): string {
  const result = value
    // 处理常见转义字符
    .replace(
      /\\([nrt\\])/g,
      (_, char: string) =>
        (
          ({
            n: '\n',
            r: '\r',
            t: '\t',
            '\\': '\\',
          }) as Record<string, string>
        )[char] || char
    )

    // 处理 Unicode 转义序列 - \uXXXX
    .replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) => decodeHtmlEntityCodePoint(hex, 16) ?? match)
    // 二次转义序列
    .replace(/\\\\u([0-9a-fA-F]{4})/g, (match, hex) => decodeHtmlEntityCodePoint(hex, 16) ?? match);

  // 处理HTML实体
  return decodeHtmlEntities(result);
}

/**
 * 递归解码对象中所有字符串的转义序列
 * @param value - 需要解码的值
 * @returns 解码后的值
 */
function decodeUnicodeEscapes(value: unknown): unknown {
  const stringValue = decodeStringSchema.safeParse(value);
  if (stringValue.success) {
    return decodeStringValue(stringValue.data);
  }

  const arrayValue = decodeArraySchema.safeParse(value);
  if (arrayValue.success) {
    return arrayValue.data.map(decodeUnicodeEscapes);
  }

  const recordValue = decodeRecordSchema.safeParse(value);
  if (recordValue.success) {
    return Object.fromEntries(
      Object.entries(recordValue.data).map(([key, nestedValue]) => [
        key,
        decodeUnicodeEscapes(nestedValue),
      ])
    );
  }

  // 其他类型直接返回
  return value;
}

export { decodeUnicodeEscapes };
