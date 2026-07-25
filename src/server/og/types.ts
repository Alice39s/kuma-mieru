import type { NormalizedStatus } from '../adapters/types.js';

export type OgView = 'overview' | 'metrics' | 'methodology';

export interface OgImageInput {
  pageId: string;
  pageSlug: string;
  title: string;
  description: string;
  status: NormalizedStatus;
  stale: boolean;
  view: OgView;
  services: Array<{ name: string; status: NormalizedStatus }>;
}

export interface OgImageResult {
  bytes: Buffer;
  etag: string;
  source: 'rendered' | 'memory' | 'fallback';
}

export interface OgImageService {
  render(input: OgImageInput): Promise<OgImageResult>;
}
