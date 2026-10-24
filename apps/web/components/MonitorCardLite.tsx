import type { MonitorCardProps } from '@/types/monitor';
import { Button, Card, CardBody, Chip, Tooltip } from '@heroui/react';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import { LayoutGrid } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { ResponsStats } from './charts/ResponsStats';
import { StatusBlockIndicator } from './charts/StatusBlockIndicator';
import { usePageConfig } from './context/PageConfigContext';
import {
  getMonitorCardStatusMeta,
  getMonitorDetailPath,
  getTagChipStyle,
  getUptimeRingData,
} from './utils/monitor-card';

interface MonitorCardLiteProps extends MonitorCardProps {
  onToggleView: (e: React.MouseEvent) => void;
  disableViewToggle?: boolean;
}

export function MonitorCardLite({
  monitor,
  heartbeats,
  uptime24h,
  isHome = true,
  onToggleView,
  disableViewToggle = false,
}: MonitorCardLiteProps) {
  const router = useRouter();
  const pageConfig = usePageConfig();
  const { statusVisual, StatusIcon } = getMonitorCardStatusMeta(heartbeats);
  const t = useTranslations('');

  const uptimeData = getUptimeRingData(uptime24h, statusVisual.ringFill);

  const handleClick = () => {
    if (isHome) {
      const detailPath = getMonitorDetailPath(monitor.id, pageConfig.pageId);
      router.push(detailPath);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="w-full"
      onClick={handleClick}
      whileHover={isHome ? { y: -3, transition: { duration: 0.2 } } : {}}
    >
      <Card
        className={clsx('w-full h-auto', isHome && 'cursor-pointer hover:shadow-md transition-all')}
      >
        <CardBody className="py-2 px-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <StatusIcon className={clsx(statusVisual.iconClassName, 'h-5 w-5 shrink-0')} />
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <div className="min-w-0 flex-1">
                  <Tooltip content={monitor.name} placement="top" delay={300}>
                    <h3 className="truncate text-ellipsis whitespace-nowrap font-semibold">
                      {monitor.name}
                    </h3>
                  </Tooltip>
                </div>

                {monitor.tags && monitor.tags.length > 0 && (
                  <div className="hidden shrink-0 items-center gap-1 sm:flex">
                    <Chip
                      key={monitor.tags[0].id}
                      size="sm"
                      variant="flat"
                      style={getTagChipStyle(monitor.tags[0].color)}
                      className="h-5"
                    >
                      {monitor.tags[0].name}
                    </Chip>
                    {monitor.tags.length > 1 && (
                      <Tooltip
                        content={
                          <div className="px-1 py-2 flex max-w-[16rem] flex-wrap gap-1.5">
                            {monitor.tags.slice(1).map(tag => (
                              <Chip
                                key={tag.id}
                                size="sm"
                                variant="flat"
                                style={getTagChipStyle(tag.color)}
                                className="h-5"
                              >
                                {tag.name}
                                {tag.value ? `: ${tag.value}` : ''}
                              </Chip>
                            ))}
                          </div>
                        }
                      >
                        <Chip size="sm" variant="flat" className="h-5 cursor-help">
                          +{monitor.tags.length - 1}
                        </Chip>
                      </Tooltip>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <div className="shrink-0">
                <ResponsStats
                  value={uptimeData[0].value}
                  fill={uptimeData[0].fill}
                  isHome={isHome}
                  size="sm"
                  valueClassName={statusVisual.valueClassName}
                />
              </div>
              {!disableViewToggle && (
                <Tooltip content={t('view.switchToFull')}>
                  <Button isIconOnly size="sm" variant="light" onClick={onToggleView}>
                    <LayoutGrid size={16} />
                  </Button>
                </Tooltip>
              )}
            </div>
          </div>

          {/* 在大屏幕上显示状态块指示器 */}
          <div className="hidden md:block">
            <StatusBlockIndicator
              heartbeats={heartbeats}
              isHome={isHome}
              className="mt-1"
              showHeader={false}
            />
          </div>
        </CardBody>
      </Card>
    </motion.div>
  );
}
