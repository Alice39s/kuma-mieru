/**
 * Format latency value with appropriate unit
 * @param ms latency in milliseconds
 * @returns formatted string with unit
 */
export function formatLatency(ms: number): string {
  if (!ms && ms !== 0) return '-';

  if (ms < 200) {
    return `${ms.toFixed(0)} ms`;
  }

  if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)} s`;
  }

  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(1);
  return `${minutes}m ${seconds}s`;
}

/**
 * Format latency value for chart axis display
 * @param ms latency in milliseconds
 * @returns formatted string with unit, more compact than formatLatency
 */
export function formatLatencyForAxis(ms: number): string {
  if (ms <= 200) {
    return `${ms} ms`;
  }

  if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }

  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(1);
  return `${minutes}m${seconds}s`;
}

/**
 * Get color based on latency value for UI display
 * @param ms latency in milliseconds
 * @returns color key for HeroUI components:
 * - "success" for < 100ms
 * - "warning" for 100ms-1000ms
 * - "danger" for > 1000ms or invalid values
 */
export function getLatencyColor(ms: number): 'success' | 'warning' | 'danger' {
  if (!ms && ms !== 0) return 'danger';
  if (ms < 200) return 'success';
  if (ms < 1000) return 'warning';
  return 'danger';
}

/**
 * Convert a date string to a relative time string in Chinese
 * @param date ISO date string to convert
 * @returns relative time string in Chinese (e.g. "3 分钟前")
 */
export function timeAgo(date: string): string {
  const seconds = Math.floor((+new Date() - +new Date(date)) / 1000);

  const intervals: { [key: string]: number } = {
    年: 31536000,
    个月: 2592000,
    天: 86400,
    小时: 3600,
    分钟: 60,
    秒: 1,
  };

  for (const [unit, secondsInUnit] of Object.entries(intervals)) {
    const interval = Math.floor(seconds / secondsInUnit);
    if (interval >= 1) {
      return `${interval} ${unit}前`;
    }
  }

  return '刚刚';
}

/**
 * Convert UTC date string to timestamp
 * @param date Date string in format 'YYYY-MM-DD HH:MM:SS' (UTC)
 * @returns timestamp in milliseconds
 */
export function dateStringToTimestamp(date: string): number {
  const timestamp = new Date(date).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/**
 * Extract the first sentence from a markdown string, skipping the title
 * @param markdown markdown string
 * @returns first sentence of the main content (excluding title)
 */
export function extractSentence(markdown: string): string {
  const noLinks = markdown.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  const noImages = noLinks.replace(/!\[([^\]]*)\]\([^)]+\)/g, '');
  const noCode = noImages.replace(/```[\s\S]*?```/g, '');
  const noInlineCode = noCode.replace(/`[^`]+`/g, '');

  const lines = noInlineCode.split('\n');
  const contentLines = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (/^#{1,6}\s/.test(trimmed)) return false;
    if (/^[-*_]{3,}$/.test(trimmed)) return false;
    if (/^[-*+]\s+/.test(trimmed)) return false;
    if (/^>\s+/.test(trimmed)) return false;
    return true;
  });

  const content = contentLines.join(' ');
  const sanitizeHtml = require('sanitize-html');
  const noHtml = sanitizeHtml(content, {
    allowedTags: [],
    allowedAttributes: {}
  });
  const cleaned = noHtml.replace(/\s+/g, ' ').trim();

  const match = cleaned.match(/[^.!?]+[.!?]/);
  if (match) {
    return `${match[0]} ...`;
  }

  return cleaned.length > 100 ? `${cleaned.slice(0, 100)} ...` : cleaned;
}
