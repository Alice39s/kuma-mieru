'use client';

import { cn } from '@heroui/react';
import { AlertTriangle, CheckCircle, Clock, type LucideIcon, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useMonitorData } from '../utils/swr';

const pingAnimation = {
  animation: 'slowPing 3s cubic-bezier(0,0,0.2,1) infinite',
} as const;

export function SystemStatusAlert() {
  const t = useTranslations('status');
  const { monitoringData, monitorGroups, isLoading: isLoadingMonitors } = useMonitorData();

  const isLoading = isLoadingMonitors;
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setAnimate(true);
      setTimeout(() => setAnimate(false), 1000);
    }, 1000);

    setAnimate(true);
    setTimeout(() => setAnimate(false), 1000);

    return () => clearInterval(interval);
  }, []);

  const totalMonitors = monitorGroups.reduce((sum, group) => sum + group.monitorList.length, 0);

  const onlineMonitors = Object.entries(monitoringData?.heartbeatList || {}).filter(
    ([_, heartbeats]) => heartbeats.length > 0 && heartbeats[0].status === 1
  ).length;

  const offlineMonitors = Object.entries(monitoringData?.heartbeatList || {}).filter(
    ([_, heartbeats]) => heartbeats.length > 0 && heartbeats[0].status === 0
  ).length;

  const maintenanceMonitors = Object.entries(monitoringData?.heartbeatList || {}).filter(
    ([_, heartbeats]) => heartbeats.length > 0 && heartbeats[0].status === 2
  ).length;

  let systemStatus = 'normal';

  if (!isLoading) {
    if (offlineMonitors - totalMonitors === 0) {
      systemStatus = 'error';
    } else if (maintenanceMonitors > 0 || offlineMonitors > 0) {
      systemStatus = 'warning';
    }
  }

  const getBackgroundStyle = () => {
    if (isLoading) {
      return 'from-gray-400 to-gray-600 dark:from-gray-600 dark:to-gray-800';
    }

    switch (systemStatus) {
      case 'normal':
        return 'from-green-400 to-green-600 dark:from-green-600 dark:to-green-800';
      case 'warning':
        return 'from-amber-400 to-amber-600 dark:from-amber-600 dark:to-amber-800';
      case 'error':
        return 'from-red-400 to-red-600 dark:from-red-600 dark:to-red-800';
      default:
        return 'from-gray-400 to-gray-600 dark:from-gray-600 dark:to-gray-800';
    }
  };

  const getIconBgStyle = () => {
    return 'bg-white/30 dark:bg-white/25';
  };

  const statusIcons: Record<string, LucideIcon> = {
    normal: CheckCircle,
    warning: AlertTriangle,
    error: X,
    loading: Clock,
  };

  const getStatusIcon = () => {
    const status = isLoading ? 'loading' : systemStatus;
    const Icon = statusIcons[status] || statusIcons.loading;

    return (
      <Icon
        className={cn('w-6 h-6 text-white transition-transform', animate ? 'scale-110' : '')}
        aria-hidden="true"
      />
    );
  };

  const getStatusText = () => {
    if (isLoading) return t('loading');
    switch (systemStatus) {
      case 'normal':
        return t('systemNormal');
      case 'warning':
        return t('systemWarning');
      case 'error':
        return t('systemError');
      default:
        return t('systemUnknown');
    }
  };

  return (
    <div
      className={`relative overflow-hidden w-full py-3 md:py-4 px-4 md:px-6 bg-linear-to-r ${getBackgroundStyle()} shadow-lg rounded-2xl mx-auto my-4`}
    >
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute right-0 top-0 rounded-full w-64 h-64 -mt-32 -mr-32 bg-white/5" />
        <div className="absolute left-0 bottom-0 rounded-full w-48 h-48 -mb-24 -ml-24 bg-black/5" />
      </div>

      <div className="max-w-(--breakpoint-xl) mx-auto">
        <div className="flex flex-col items-center md:items-start">
          <div className={cn('flex items-center relative z-10', animate ? 'animate-pulse' : '')}>
            <div className="relative">
              <style>{`
                @keyframes slowPing {
                  75%, 100% {
                    transform: scale(2);
                    opacity: 0;
                  }
                }
              `}</style>
              <div
                className="absolute -inset-4 bg-white/20 rounded-full -z-10"
                style={pingAnimation}
              />
              <div
                className={`rounded-full p-2.5 mr-3 ${getIconBgStyle()} backdrop-blur-sm transition-all relative z-10`}
              >
                {getStatusIcon()}
              </div>
            </div>
            <h1 className="text-white font-bold text-xl md:text-xl tracking-wide">
              {isLoading ? (
                <div className="h-7 w-56 bg-white/20 rounded animate-pulse" />
              ) : (
                <>
                  {getStatusText()}
                  <span className="text-white/90 text-sm md:text-base ml-2">{`(${onlineMonitors}/${totalMonitors})`}</span>
                </>
              )}
            </h1>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SystemStatusAlert;
