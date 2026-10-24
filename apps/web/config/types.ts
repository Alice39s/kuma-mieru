export interface GeneratedPageConfig {
  id: string;
  baseUrl: string;
  siteMeta: {
    title: string;
    description: string;
    icon: string;
    iconCandidates: string[];
  };
}

export interface GeneratedConfig {
  /** Default base URL (first page's base URL). Used as fallback when a page has no explicit baseUrl. */
  baseUrl: string;
  pageId: string;
  pageIds: string[];
  pages: GeneratedPageConfig[];
  siteMeta: GeneratedPageConfig['siteMeta'];
  isPlaceholder: boolean;
  isEditThisPage: boolean;
  isShowStarButton: boolean;
}
