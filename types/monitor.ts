/**
 * Monitor - Heartbeat Data
 *
 * Source: Uptime-Kuma - [server/model/heartbeat.js](https://github.com/louislam/uptime-kuma/blob/0876b1cbf5bc2beea8f28e7f93190a6f7e57f807/server/model/heartbeat.js#L3-L9)
 */
export interface Heartbeat {
  status: 0 | 1 | 2 | 3; // 0: down, 1: up, 2: pending, 3: maintenance
  time: string;
  msg: string;
  ping: number | null; // latency in ms
}

export interface UptimeData {
  [key: string]: number; // Format: "{monitorId}_{hours}" -> uptime percentage
}

export interface MonitorTag {
  id: number;
  monitor_id: number;
  tag_id: number;
  name: string;
  value?: string;
  color: string;
}

/**
 * Monitor Models
 *
 * Source: Uptime-Kuma - [server/model/...](https://github.com/louislam/uptime-kuma/tree/0876b1cbf5bc2beea8f28e7f93190a6f7e57f807/server/model)
 */
export interface Monitor {
  id: number;
  name: string;
  sendUrl: number; // 0: no, 1: yes
  // server/model/monitor.js (Uptime Kuma)
  type:
    | 'keyword'
    | 'http'
    | 'ping'
    | 'port'
    | 'push'
    | 'socket'
    | 'sqlserver'
    | 'json-query'
    | 'real-browser'
    | 'kafka-producer'
    | 'redis'
    | 'radius'
    | 'mysql'
    | 'postgres'
    | 'gamedig'
    | 'dns'
    | 'steam'
    | 'mqtt'
    | 'tcp'
    | 'docker'
    | string;
  url?: string;
  certExpiryDaysRemaining?: number; // only for 'http', 'keyword', 'certexpiry', 'json-query'
  validCert?: boolean; // only for cert expiry monitor
  tags?: MonitorTag[];
}

export interface MonitorGroup {
  id: number;
  name: string;
  weight: number;
  monitorList: Monitor[];
}

export interface HeartbeatData {
  [key: string]: Heartbeat[]; // key is monitor ID
}

export interface MonitoringData {
  heartbeatList: HeartbeatData;
  uptimeList: UptimeData;
}

/**
 * Incident Message (Maintenance)
 */
export interface Incident {
  id: number;
  style: 'info' | 'warning' | 'danger' | 'primary' | 'light' | 'dark';
  // info -> primary
  // light -> default
  // dark -> secondary
  title: string;
  content: string;
  pin: number;
  createdDate: string;
  lastUpdatedDate: string;
}

/**
 * Monitor Response
 */
export interface MonitorResponse {
  success: boolean;
  monitorGroups: MonitorGroup[];
  data: MonitoringData;
}

/*
 * Monitor Card Props
 */
export interface MonitorCardProps {
  monitor: Monitor;
  heartbeats: Heartbeat[];
  uptime24h: number;
  isHome?: boolean;
  isLiteView?: boolean;
  disableViewToggle?: boolean;
  pageId?: string; // 用于传递状态页ID
}

/*
 * Monitor Card Lite Props
 */
export interface MonitorCardLiteProps {
  monitor: Monitor;
  heartbeats: Heartbeat[];
  uptime24h: number;
  isHome?: boolean;
  onToggleView: (e: React.MouseEvent) => void;
  disableViewToggle?: boolean;
  pageId?: string; // 用于传递状态页ID
}
