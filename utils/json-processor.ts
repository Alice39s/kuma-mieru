import JSON5 from 'json5';
import type { PreloadData } from '../types/config';
import { ConfigError } from './errors';
import { sanitizeJsonString, validatePreloadData } from './json-sanitizer';

export function extractPreloadData(jsonStr: string): PreloadData {
  const payload = sanitizeJsonString(jsonStr);
  try {
    const parsed: PreloadData = JSON.parse(payload);
    if (validatePreloadData(parsed)) return parsed;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    // Older Kuma pages use JavaScript object literals supported by JSON5.
    try {
      const parsed = JSON5.parse<PreloadData>(payload);
      if (validatePreloadData(parsed)) return parsed;
    } catch (json5Error) {
      console.debug('Failed to parse preload data as JSON or JSON5', json5Error);
    }
  }

  throw new ConfigError(`All parsing methods failed\nCleaned data: ${jsonStr.slice(0, 200)}...`);
}
