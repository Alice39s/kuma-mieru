import type { GeneratedConfig, PageConfig, SiteMeta } from '@/config/types';
import type { Incident, MonitorGroup } from './monitor';

export interface Config extends GeneratedConfig {
  htmlEndpoint: string;
  apiEndpoint: string;
  currentPageId: string; // 当前选中的页面ID
  siteMeta: SiteMeta; // 当前页面的站点元数据
}

export interface SiteConfig {
  slug: string;
  title: string;
  description: string;
  icon: string;
  theme: 'light' | 'dark' | 'system';
  published: boolean;
  showTags: boolean;
  customCSS: string;
  footerText: string;
  showPoweredBy: boolean;
  googleAnalyticsId: string | null;
  showCertificateExpiry: boolean;
}

export interface GlobalConfig {
  config: SiteConfig;
  incident?: Incident;
  maintenanceList?: Maintenance[];
}

/**
 * 时间规划
 *
 */
export interface TimeObject {
  hours: number;
  minutes: number;
}

export interface TimeSlot {
  startDate: string;
  endDate: string;
}

/**
 * 维护计划
 *
 * Source: Uptime-Kuma - [server/model/maintenance.js](https://github.com/louislam/uptime-kuma/blob/30f7b4898758ea5422983d00a3d3a3597e7e1524/server/model/maintenance.js#L223-L293)
 */
export interface Maintenance {
  id: number;
  title: string;
  description: string;
  strategy: 'manual' | 'single' | 'scheduled' | 'recurring-interval' | string;
  intervalDay: number; // 总维护天数
  active: boolean; // 是否展示
  dateRange: string[]; // example: ["2025-04-22T13:00", "2025-04-22T13:59"]
  timeRange: TimeObject[]; // example: [{hours: 13, minutes: 0}, {hours: 13, minutes: 59}]
  weekdays: number[]; // 没懂意义在哪里...
  daysOfMonth: number[]; // 没懂意义在哪里...
  timeslotList: TimeSlot[]; // 和 dateRange 类似，但是多了 startDate & endDate
  cron: string; // example: "0 0 1 * *", unix-cron string format
  durationMinutes: number | null;
  timezone: string;
  timezoneOption: string;
  timezoneOffset: string; // example: "+08:00"，使用时区以此为准 (仅 Maintenance 中有效)
  status: 'inactive' | 'under-maintenance' | 'scheduled' | 'ended' | 'unknown' | string;
}

/**
 * 预加载数据接口
 */
export interface PreloadData {
  config: {
    slug: string;
    title: string;
    description: string;
    icon: string;
    theme: string;
    published: boolean;
    // 是否显示节点标签
    showTags: boolean;
    // 是否显示自定义 CSS, 由于是 SSR，所以没啥用
    customCSS: string;
    // 页脚文本
    footerText: string;
    // 是否显示 Powered by 信息
    showPoweredBy: boolean;
    // 是否显示 Google Analytics
    googleAnalyticsId: string | null;
    // 是否显示证书过期信息
    showCertificateExpiry: boolean;
  };

  // 监控组
  publicGroupList: MonitorGroup[];

  // 维护计划列表
  maintenanceList: Maintenance[];

  // 维护信息
  incident?: Incident;
}
