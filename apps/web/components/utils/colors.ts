export const COLOR_SYSTEM = {
  excellent: {
    // 优秀、纯绿
    text: 'text-success-600 dark:text-success-500',
    bg: {
      light: 'bg-success',
      dark: 'bg-success',
    },
    label: 'node.online',
    showInLegend: true,
  },
  good: {
    // 良好、中绿
    text: 'text-success-600/90 dark:text-success-500/90',
    bg: {
      light: 'bg-success/80',
      dark: 'bg-success/80',
    },
    label: 'node.online',
    showInLegend: false,
  },
  normal: {
    // 正常、中绿
    text: 'text-success-600/70 dark:text-success-500/70',
    bg: {
      light: 'bg-success/60',
      dark: 'bg-success/60',
    },
    label: 'node.online',
    showInLegend: false,
  },
  warning: {
    text: 'text-warning-600 dark:text-warning-500',
    bg: {
      light: 'bg-warning/80',
      dark: 'bg-warning',
    },
    label: 'node.pending',
    showInLegend: true,
  },
  maintenance: {
    text: 'text-primary-500/90 dark:text-primary-400/90',
    bg: {
      light: 'bg-primary/30',
      dark: 'bg-primary/80',
    },
    label: 'node.maintenance',
    showInLegend: true,
  },
  error: {
    text: 'text-danger-600 dark:text-danger-500',
    bg: {
      light: 'bg-danger/80',
      dark: 'bg-danger',
    },
    label: 'node.offline',
    showInLegend: true,
  },
} as const;

export type PingThresholds = {
  excellent: number;
  good: number;
  normal: number;
};

// 默认的延迟阈值配置
export const DEFAULT_PING_THRESHOLDS: PingThresholds = {
  excellent: 100, // 优秀: <= 100ms
  good: 200, // 良好: <= 200ms
  normal: 300, // 正常: <= 300ms
};

// 基于固定阈值的颜色判断
export const getPingColorClass = (
  ping: number,
  thresholds: PingThresholds = DEFAULT_PING_THRESHOLDS
) => {
  if (ping <= thresholds.excellent) return COLOR_SYSTEM.excellent;
  if (ping <= thresholds.good) return COLOR_SYSTEM.good;
  if (ping <= thresholds.normal) return COLOR_SYSTEM.normal;
  return COLOR_SYSTEM.normal;
};

// 基于统计数据的颜色判断
export const getStatusColorByStats = (
  ping: number,
  stats: { p25: number; p50: number; p75: number; max: number }
) => {
  if (!ping) return COLOR_SYSTEM.excellent;

  // 根据统计数据动态计算状态
  if (ping <= stats.p25) return COLOR_SYSTEM.excellent;
  if (ping <= stats.p50) return COLOR_SYSTEM.excellent;
  if (ping <= stats.p75) return COLOR_SYSTEM.good;
  if (ping <= stats.max * 0.9) return COLOR_SYSTEM.normal;
  return COLOR_SYSTEM.normal;
};
