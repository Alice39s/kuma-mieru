import type { MonitorCardProps } from '@/types/monitor';
import { MONITOR_STATUS_VISUAL, getMonitorStatusKey } from '@/utils/monitor-status';
import { Button, Card, CardBody, Chip, Tooltip } from '@heroui/react';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import { AlertCircle, CheckCircle2, LayoutGrid, MinusCircle, Wrench } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { ResponsStats } from './charts/ResponsStats';
import { StatusBlockIndicator } from './charts/StatusBlockIndicator';
import { usePageConfig } from './context/PageConfigContext';

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
  const lastHeartbeat = heartbeats[heartbeats.length - 1];
  const currentStatus = getMonitorStatusKey(lastHeartbeat?.status);
  const statusVisual = MONITOR_STATUS_VISUAL[currentStatus];
  const statusIconMap = {
    up: CheckCircle2,
    pending: MinusCircle,
    down: AlertCircle,
    maintenance: Wrench,
    unknown: AlertCircle,
  } as const;
  const StatusIcon = statusIconMap[currentStatus];
  const t = useTranslations('');

  const uptimeData = [
    {
      value: uptime24h * 100,
      fill: statusVisual.ringFill,
    },
  ];

  const handleClick = () => {
    if (isHome) {
      const detailPath = `/monitor/${monitor.id}?pageId=${encodeURIComponent(pageConfig.pageId)}`;
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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <StatusIcon className={clsx(statusVisual.iconClassName, 'h-5 w-5 shrink-0')} />
              <Tooltip content={monitor.name} placement="top" delay={300}>
                <h3 className="font-semibold truncate text-ellipsis max-w-[8.5rem] md:max-w-[11rem]">
                  {monitor.name}
                </h3>
              </Tooltip>

              {monitor.tags && monitor.tags.length > 0 && (
                <div className="flex-wrap gap-1 ml-2 hidden sm:flex">
                  <Chip
                    key={monitor.tags[0].id}
                    size="sm"
                    variant="flat"
                    style={{
                      backgroundColor: `${monitor.tags[0].color}15`,
                      color: monitor.tags[0].color,
                    }}
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
                              style={{
                                backgroundColor: `${tag.color}15`,
                                color: tag.color,
                              }}
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

            <div className="flex items-center gap-2">
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
            <StatusBlockIndicator heartbeats={heartbeats} isHome={isHome} className="mt-2" />
          </div>
        </CardBody>
      </Card>
    </motion.div>
  );
}
