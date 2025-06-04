export interface SiteMeta {
  title: string;
  description: string;
  icon: string;
}

export interface PageConfig {
  id: string;
  name?: string;
  siteMeta: SiteMeta;
}

export interface GeneratedConfig {
  baseUrl: string;
  defaultPageId: string;
  pages: PageConfig[];
  isPlaceholder: boolean;
  isEditThisPage: boolean;
  isShowStarButton: boolean;
}
