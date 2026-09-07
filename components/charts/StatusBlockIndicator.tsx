import type { Heartbeat } from '@/types/monitor';
import { clsx } from 'clsx';
import dayjs from 'dayjs';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { CustomTooltip } from '../ui/CustomTooltip';
import { calculatePingStats, getStatusColor } from '../utils/charts';
import { COLOR_SYSTEM } from '../utils/colors';
import { PingStats } from './PingStats';

interface StatusBlockIndicatorProps {
  heartbeats: Heartbeat[];
  className?: string;
  isHome?: boolean;
  showHeader?: boolean;
}

const BLOCK_BASE_CLASS =
  'flex-1 h-full cursor-pointer transition-all hover:opacity-80 dark:hover:opacity-90 min-w-[2px]';

const LEGEND_COLORS = Object.entries(COLOR_SYSTEM).filter(([, value]) => value.showInLegend);

export function StatusBlockIndicator({
  heartbeats,
  className,
  isHome = true,
  showHeader = true,
}: StatusBlockIndicatorProps) {
  const t = useTranslations();
  const targetVisibleBars = heartbeats.length >= 100 ? 100 : 50;

  // 统计维度保持在最近 50 个点，避免旧数据抬高平均值
  const recentHeartbeats = useMemo(() => heartbeats.slice(-50), [heartbeats]);

  // 条形图在首页采用更紧凑的最近窗口，详情页展示完整 100 点
  const visibleHeartbeats = useMemo(
    () => heartbeats.slice(-targetVisibleBars),
    [heartbeats, targetVisibleBars]
  );

  // 计算延迟动态分布
  const pingStats = useMemo(() => calculatePingStats(recentHeartbeats), [recentHeartbeats]);

  const heartbeatBlocks = useMemo(() => {
    if (visibleHeartbeats.length === 0) return [];

    return visibleHeartbeats.map(hb => {
      const colorInfo = getStatusColor(hb, pingStats);
      const tooltipContent = (
        <div key={hb.time} className="flex w-full items-center gap-x-2">
          <div className="flex w-full flex-col gap-y-1">
            <div className="flex w-full items-center gap-x-1 text-small">
              <span className={clsx('text-small font-medium', colorInfo.text)}>
                {t(colorInfo.label)}
              </span>
              <span className="text-foreground/60 dark:text-foreground/40">-</span>
              <span className="text-foreground/60 dark:text-foreground/40">
                {dayjs(hb.time).format('YYYY-MM-DD HH:mm:ss')}
              </span>
            </div>
          </div>
        </div>
      );

      return {
        key: hb.time,
        blockClassName: clsx(BLOCK_BASE_CLASS, hb.ping ? colorInfo.bg.dark : colorInfo.bg.light),
        tooltipContent,
      };
    });
  }, [visibleHeartbeats, pingStats, t]);

  return (
    <div className={clsx('relative mt-4 flex flex-col gap-1 min-w-0', className)}>
      {/* 图例和延迟统计 */}
      <div className="absolute -top-5 flex w-full items-center justify-between">
        {showHeader && <PingStats heartbeats={recentHeartbeats} isHome={isHome} />}
        <div
          className={clsx(
            'flex items-center gap-2 text-xs text-foreground/80 dark:text-foreground/60',
            isHome && 'ml-auto'
          )}
        >
          {showHeader &&
            LEGEND_COLORS.map(([key, value]) => (
              <div key={key} className="flex items-center gap-1 text-xs">
                <div className={clsx('w-1.5 h-1.5 rounded-full', value.bg.dark)} />
                <span>{t(value.label)}</span>
              </div>
            ))}
        </div>
      </div>

      {/* 状态块 */}
      <div className="flex gap-px md:gap-0.5 mt-2 h-3 w-[98%] justify-end items-center mx-auto rounded-sm overflow-hidden">
        {heartbeatBlocks.map(({ key, tooltipContent, blockClassName }) => (
          <CustomTooltip key={key} content={tooltipContent}>
            <div className={blockClassName} />
          </CustomTooltip>
        ))}
      </div>
    </div>
  );
}
