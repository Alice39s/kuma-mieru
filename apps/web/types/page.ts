export type PageFailureType =
  | 'timeout'
  | 'network_reset'
  | 'http_4xx'
  | 'http_5xx'
  | 'parse_error'
  | 'unknown';

export type PageHealthStatus = 'healthy' | 'unavailable';

export interface PageTabMeta {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  health: PageHealthStatus;
  failureType?: PageFailureType;
  failureMessage?: string;
  failureStatusCode?: number;
  failureStatusMessage?: string;
}

export interface PageTabsStatusMatrix {
  status: 'ok' | 'partial_failed' | 'all_failed';
  failedPageIds: string[];
}
