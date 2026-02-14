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
 * Convert date string to timestamp with timezone support
 * @param dateString Date string in ISO format or 'YYYY-MM-DD HH:MM:SS'
 * @param tz Timezone offset in format '+HH:MM' or 'UTC'
 * @returns timestamp in milliseconds
 */
export function dateStringToTimestamp(dateString: string, tz = '+0000'): number {
  if (!dateString) return 0;

  try {
    const dateStr = dateString.trim().replace(' +0000', '');
    const timezone = tz.replace(':', '').replace('UTC', '+0000');

    let timestamp = new Date(`${dateStr} ${timezone}`).getTime();

    if (!Number.isFinite(timestamp)) {
      timestamp = new Date(dateStr).getTime();

      if (Number.isFinite(timestamp) && timezone !== '+0000') {
        const tzOffsetMs =
          Number.parseInt(timezone.slice(1, 3)) * 3600000 +
          Number.parseInt(timezone.slice(3, 5)) * 60000;
        timestamp += timezone.startsWith('-') ? tzOffsetMs : -tzOffsetMs;
      }
    }

    return Number.isFinite(timestamp) ? timestamp : 0;
  } catch {
    return 0;
  }
}

/**
 * Convert timezone offset strings (e.g. "+08:00" or "-0530") into milliseconds.
 * @param offset timezone offset string or undefined/"UTC"
 * @returns offset duration in milliseconds, positive east of UTC
 */
export function timezoneOffsetToMs(offset?: string): number {
  if (!offset || offset === 'UTC') {
    return 0;
  }

  const normalized = offset.replace(':', '');
  if (!/^[+-]\d{4}$/.test(normalized)) {
    return 0;
  }

  const sign = normalized.startsWith('-') ? -1 : 1;
  const hours = Number.parseInt(normalized.slice(1, 3), 10);
  const minutes = Number.parseInt(normalized.slice(3, 5), 10);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return 0;
  }

  const totalMinutes = hours * 60 + minutes;
  return sign * totalMinutes * 60 * 1000;
}
