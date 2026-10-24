'use client';

import { cn } from '@heroui/react';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { Pause, Play, RefreshCw } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

dayjs.extend(utc);
dayjs.extend(timezone);

interface AutoRefreshProps {
  onRefresh: () => Promise<void> | void;
  interval?: number;
  children: ReactNode;
}

interface RefreshButtonProps {
  isRefreshing: boolean;
  onClick: () => void;
  children: ReactNode;
}

interface HandleRefreshOptions {
  showToast?: boolean;
}

interface ControlButtonProps {
  isPaused: boolean;
  onClick: () => void;
}

function RefreshButton({ isRefreshing, onClick, children }: RefreshButtonProps) {
  const t = useTranslations('timer');
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-2 px-3 py-1 text-sm rounded-md transition-all duration-200
        ${
          isRefreshing
            ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed scale-95'
            : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 hover:scale-105 active:scale-95'
        }`}
      onClick={onClick}
      disabled={isRefreshing}
    >
      <RefreshCw
        className={`h-4 w-4 transition-transform ${isRefreshing ? 'animate-spin' : 'group-hover:rotate-180'}`}
      />
      {isRefreshing ? t('refreshing') : children}
    </button>
  );
}

function ControlButton({ isPaused, onClick }: ControlButtonProps) {
  const t = useTranslations('timer');
  return (
    <button
      type="button"
      className="inline-flex items-center gap-2 px-3 py-1 text-sm rounded-md 
        bg-blue-100 dark:bg-blue-900/30 hover:bg-blue-200 dark:hover:bg-blue-900/50 
        text-blue-700 dark:text-blue-400 transition-all duration-200
        hover:scale-105 active:scale-95"
      onClick={onClick}
    >
      {isPaused ? (
        <Play className="h-4 w-4 transition-transform hover:translate-x-0.5" />
      ) : (
        <Pause className="h-4 w-4 transition-transform hover:scale-110" />
      )}
      {isPaused ? t('paused') : t('pause')}
    </button>
  );
}

export default function AutoRefresh({ onRefresh, interval = 60000, children }: AutoRefreshProps) {
  const t = useTranslations('timer');
  const format = useFormatter();

  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [timeLeft, setTimeLeft] = useState<number>(interval);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastRefreshTime, setLastRefreshTime] = useState<number>(Date.now());
  const [showRefreshAnimation, setShowRefreshAnimation] = useState<boolean>(false);

  const handleRefresh = useCallback(
    async ({ showToast = true }: HandleRefreshOptions = {}) => {
      if (isRefreshing) return;

      setIsRefreshing(true);
      setShowRefreshAnimation(true);

      try {
        const toastId = showToast ? toast.loading(t('refreshing')) : undefined;

        const result = onRefresh();
        if (result instanceof Promise) {
          await result;
        }

        if (showToast) {
          toast.success(t('refreshSuccess'), {
            id: toastId,
          });
        }

        setLastRefreshTime(dayjs().valueOf());
      } catch (error) {
        console.error(t('error.refresh'), ':', error);
        toast.error(
          `${t('error.refresh')}: ${error instanceof Error ? error.message : t('error.unknown')}`
        );
      } finally {
        setIsRefreshing(false);
        setTimeLeft(interval);
        setTimeout(() => setShowRefreshAnimation(false), 500);
      }
    },
    [isRefreshing, onRefresh, interval, t]
  );

  const handleTogglePause = useCallback(() => {
    const newPausedState = !isPaused;
    setIsPaused(newPausedState);

    if (newPausedState) {
      toast.info(t('pausedInfo'));
    } else {
      toast.info(t('resumedInfo'));
    }
  }, [isPaused, t]);

  const handleSilentRefresh = useCallback(
    () => handleRefresh({ showToast: false }),
    [handleRefresh]
  );
  const handleManualRefresh = useCallback(() => {
    void handleRefresh();
  }, [handleRefresh]);

  useEffect(() => {
    if (isPaused) return;

    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1000) {
          void handleSilentRefresh();
          return interval;
        }
        return prev - 1000;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isPaused, interval, handleSilentRefresh]);

  const progress = (timeLeft / interval) * 100;

  return (
    <>
      <div
        className={cn(
          'sticky top-0 left-0 right-0',
          'bg-background rounded-b-large',
          'p-4 space-y-2 z-40'
        )}
      >
        <div className="flex items-center gap-4 max-w-7xl mx-auto">
          <div className="flex-1">
            <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden transition-colors duration-300">
              <div
                className={`h-full bg-linear-to-r from-blue-500 to-blue-400 transition-all duration-1000 
                  ${isPaused ? 'opacity-50' : 'opacity-100'} 
                  ${isRefreshing ? 'animate-pulse' : ''}`}
                style={{
                  width: `${!isPaused ? progress : 0}%`,
                  transition: isRefreshing ? 'none' : 'all 1s linear',
                }}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ControlButton isPaused={isPaused} onClick={handleTogglePause} />
            <RefreshButton isRefreshing={isRefreshing} onClick={handleManualRefresh}>
              {t('refreshNow')}
            </RefreshButton>
          </div>
        </div>

        <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400 max-w-7xl mx-auto transition-colors duration-300">
          <div suppressHydrationWarning={true}>
            {t('lastTime', {
              time: format.dateTime(dayjs(lastRefreshTime).toDate(), {
                timeZone: dayjs.tz.guess(),
                hour: 'numeric',
                minute: 'numeric',
                second: 'numeric',
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
              }),
            })}
          </div>
          {!isPaused && (
            <div
              suppressHydrationWarning={true}
              className={`transition-opacity duration-300 ${isPaused ? 'opacity-0' : 'opacity-100'}`}
            >
              {t('nextTime', {
                sec: Math.ceil(timeLeft / 1000),
              })}
            </div>
          )}
        </div>
      </div>

      <div
        className={`transition-all duration-300 ${showRefreshAnimation ? 'opacity-30 scale-[0.99] blur-[1px]' : ''}`}
      >
        {children}
      </div>
    </>
  );
}
