type DeepRecord = { [key: string]: DeepRecord | unknown };

// HTML实体映射表
const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&nbsp;': ' ',
  '&copy;': '©',
  '&reg;': '®',
  '&trade;': '™',
  '&mdash;': '—',
  '&ndash;': '–',
  '&hellip;': '…',
  '&laquo;': '«',
  '&raquo;': '»',
};

/**
 * 递归解码对象中所有字符串的转义序列
 * @param value - 需要解码的值
 * @returns 解码后的值
 */
function decodeUnicodeEscapes(value: unknown): unknown {
  // 字符串类型处理转义序列
  if (typeof value === 'string') {
    let result = value
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
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
      // 二次转义序列
      .replace(/\\\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));

    // 处理HTML实体
    // 1. 替换命名实体
    for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
      result = result.replace(new RegExp(entity, 'g'), char);
    }

    // 2. 替换数字实体 (十进制, 如 &#169;)
    result = result.replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number.parseInt(dec, 10)));

    // 3. 替换数字实体 (十六进制, 如 &#x00A9;)
    result = result.replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    );

    return result;
  }

  // 数组类型递归处理每个元素
  if (Array.isArray(value)) {
    return value.map(decodeUnicodeEscapes);
  }

  // 对象类型递归处理每个属性
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as DeepRecord).map(([k, v]) => [k, decodeUnicodeEscapes(v)])
    );
  }

  // 其他类型直接返回
  return value;
}

export { decodeUnicodeEscapes };
