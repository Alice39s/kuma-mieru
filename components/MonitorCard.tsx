'use client';
import type { MonitorCardProps } from '@/types/monitor';
import { Button, Card, CardBody, CardHeader, Chip, Divider, Tooltip } from '@heroui/react';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import { LayoutList } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MonitorCardLite } from './MonitorCardLite';
import { MonitoringChart } from './charts/MonitoringChart';
import { ResponsStats } from './charts/ResponsStats';
import { StatusBlockIndicator } from './charts/StatusBlockIndicator';
import { usePageConfig } from './context/PageConfigContext';
import {
  getMonitorCardStatusMeta,
  getMonitorDetailPath,
  getTagChipStyle,
  getUptimeRingData,
} from './utils/monitor-card';

const VIEW_PREFERENCE_KEY = 'view-preference-monitor-card';

export function MonitorCard({
  monitor,
  heartbeats,
  uptime24h,
  isHome = true,
  isLiteView: externalLiteView,
  disableViewToggle = false,
}: MonitorCardProps) {
  const router = useRouter();
  const pageConfig = usePageConfig();
  const [isSafari, setIsSafari] = useState(false);
  const [localLiteView, setLocalLiteView] = useState(() => {
    if (typeof window !== 'undefined') {
      const savedPreference = localStorage.getItem(VIEW_PREFERENCE_KEY);
      return savedPreference === 'lite';
    }
    return false;
  });
  const t = useTranslations('');

  // 使用外部提供的视图模式或本地模式
  const isLiteView = externalLiteView !== undefined ? externalLiteView : localLiteView;

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const userAgent = window.navigator.userAgent;
      const isSafariBrowser =
        /Safari/i.test(userAgent) &&
        !/Chrome/i.test(userAgent) &&
        !/Chromium/i.test(userAgent) &&
        !/Edge/i.test(userAgent) &&
        !/Firefox/i.test(userAgent);

      setIsSafari(isSafariBrowser);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && externalLiteView === undefined) {
      localStorage.setItem(VIEW_PREFERENCE_KEY, localLiteView ? 'lite' : 'full');
    }
  }, [localLiteView, externalLiteView]);

  const { statusVisual, StatusIcon } = getMonitorCardStatusMeta(heartbeats);
  const uptimeData = getUptimeRingData(uptime24h, statusVisual.ringFill);

  const handleClick = () => {
    if (isHome) {
      const detailPath = getMonitorDetailPath(monitor.id, pageConfig.pageId);
      router.push(detailPath);
    }
  };

  const toggleView = (e: React.MouseEvent) => {
    e.stopPropagation();
    setLocalLiteView(prev => !prev);
  };

  if (isLiteView) {
    return (
      <MonitorCardLite
        monitor={monitor}
        heartbeats={heartbeats}
        uptime24h={uptime24h}
        isHome={isHome}
        onToggleView={toggleView}
        disableViewToggle={disableViewToggle}
      />
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="group h-full"
      onClick={handleClick}
      whileHover={isHome ? { y: -3, transition: { duration: 0.2 } } : {}}
    >
      <Card
        className={clsx(
          'h-full grid grid-rows-[auto_1fr]',
          isHome ? 'w-full' : 'w-full md:w-2/3 mx-auto',
          isHome && 'cursor-pointer hover:shadow-md transition-all'
        )}
      >
        <CardHeader className="grid grid-cols-[1fr_auto] gap-4 items-start">
          <div className="grid grid-rows-[auto_minmax(28px,auto)] gap-2 min-w-0 overflow-hidden">
            <div className="flex items-center gap-2 w-full min-w-0">
              <StatusIcon className={clsx(statusVisual.iconClassName, 'h-5 w-5 ml-1 shrink-0')} />
              <Tooltip content={monitor.name} placement="top" delay={300}>
                <h3 className="text-lg font-semibold truncate text-ellipsis max-w-36 md:max-w-40 lg:max-w-48">
                  {monitor.name}
                </h3>
              </Tooltip>
            </div>
            <div>
              {monitor.tags && monitor.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {monitor.tags.map(tag => (
                    <Chip key={tag.id} size="sm" variant="flat" style={getTagChipStyle(tag.color)}>
                      {tag.name}
                      {tag?.value && `: ${tag.value}`}
                    </Chip>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-start gap-2">
            <div className={clsx('shrink-0', isHome ? '' : 'mr-4')}>
              <ResponsStats
                value={uptimeData[0].value}
                fill={uptimeData[0].fill}
                isHome={isHome}
                valueClassName={statusVisual.valueClassName}
              />
            </div>
            {!disableViewToggle && (
              <Tooltip content={t('view.switchToLite')}>
                <Button isIconOnly size="sm" variant="light" onClick={toggleView} className="mt-1">
                  <LayoutList size={16} />
                </Button>
              </Tooltip>
            )}
          </div>
        </CardHeader>
        <CardBody className="grid grid-rows-[auto_auto_1fr] gap-4">
          <StatusBlockIndicator heartbeats={heartbeats} isHome={isHome} />

          <Divider />

          <div className="self-end w-full">
            {!isSafari && (
              <MonitoringChart
                heartbeats={heartbeats}
                height={120}
                color={statusVisual.chartColor}
                showGrid
              />
            )}{' '}
            {isSafari && (
              <div className="w-full h-30 flex items-center justify-center text-default-500">
                {t('view.safariWarning')}
              </div>
            )}
          </div>
        </CardBody>
      </Card>
    </motion.div>
  );
}
