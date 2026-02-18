import type { Heartbeat } from '@/types/monitor';
import { Tooltip } from '@heroui/react';
import { clsx } from 'clsx';
import dayjs from 'dayjs';
import { useTranslations } from 'next-intl';
import React, { useEffect, useMemo, useState } from 'react';
import { CustomTooltip } from '../ui/CustomTooltip';
import { calculatePingStats, getStatusColor } from '../utils/charts';
import { COLOR_SYSTEM } from '../utils/colors';
import { PingStats } from './PingStats';

interface StatusBlockIndicatorProps {
  heartbeats: Heartbeat[];
  className?: string;
  isHome?: boolean;
}

const VIEW_PREFERENCE_KEY = 'view-preference';
const BLOCK_BASE_CLASS =
  'flex-1 h-full cursor-pointer transition-all hover:opacity-80 dark:hover:opacity-90 min-w-[4px]';

export function StatusBlockIndicator({
  heartbeats,
  className,
  isHome = true,
}: StatusBlockIndicatorProps) {
  const [isGlobalLiteView, setIsGlobalLiteView] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedPreference = localStorage.getItem(VIEW_PREFERENCE_KEY);
      if (savedPreference === 'lite') {
        setIsGlobalLiteView(true);
      }
    }
  }, []);

  const t = useTranslations();
  // 获取最近的 50 个心跳数据点
  const recentHeartbeats = useMemo(() => heartbeats.slice(-50), [heartbeats]);

  // 计算延迟动态分布
  const pingStats = useMemo(() => calculatePingStats(recentHeartbeats), [recentHeartbeats]);
  const legendItems = useMemo(
    () =>
      Object.entries(COLOR_SYSTEM)
        .filter(([_, value]) => value.showInLegend)
        .map(([key, value]) => ({
          key,
          label: t(value.label),
          dotClassName: value.bg.dark,
        })),
    [t]
  );

  const heartbeatBlocks = useMemo(() => {
    if (heartbeats.length === 0) return [];

    return heartbeats.map(hb => {
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
  }, [heartbeats, pingStats, t]);

  return (
    <div className={clsx(className, 'relative mt-4 flex flex-col gap-1 min-w-[0]')}>
      {/* 图例和延迟统计 */}
      <div className="absolute -top-5 flex w-full items-center justify-between">
        {!isGlobalLiteView && <PingStats heartbeats={recentHeartbeats} isHome={isHome} />}
        <div
          className={clsx(
            'flex items-center gap-2 text-xs text-foreground/80 dark:text-foreground/60',
            isHome && 'ml-auto'
          )}
        >
          {!isGlobalLiteView &&
            legendItems.map(({ key, dotClassName, label }) => (
              <div key={key} className="flex items-center gap-1 text-xs">
                <div className={clsx('w-1.5 h-1.5 rounded-full', dotClassName)} />
                <span>{label}</span>
              </div>
            ))}
          {isGlobalLiteView && legendItems[0] && (
            <>
              <div className="flex items-center gap-1 text-xs">
                <div className={clsx('w-1.5 h-1.5 rounded-full', legendItems[0].dotClassName)} />
                <span>{legendItems[0].label}</span>
              </div>
              {legendItems.length > 1 && (
                <Tooltip
                  content={
                    <div className="px-1 py-2">
                      {legendItems.slice(1).map(({ key, dotClassName, label }) => (
                        <div key={key} className="flex items-center gap-1.5 text-xs">
                          <div className={clsx('h-1.5 w-1.5 rounded-full', dotClassName)} />
                          <span>{label}</span>
                        </div>
                      ))}
                    </div>
                  }
                >
                  <span className="cursor-help rounded-full border border-default-200 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-foreground/70 dark:border-default-100/20">
                    +{legendItems.length - 1}
                  </span>
                </Tooltip>
              )}
            </>
          )}
        </div>
      </div>

      {/* 状态块 */}
      <div className="flex gap-0.5 mt-2 h-3 w-[98%] justify-end items-center mx-auto rounded-sm overflow-hidden">
        {heartbeatBlocks.map(({ key, tooltipContent, blockClassName }) => (
          <CustomTooltip key={key} content={tooltipContent}>
            <div className={blockClassName} />
          </CustomTooltip>
        ))}
      </div>
    </div>
  );
}
