import { apiConfig } from '@/config/api';
import type { MonitorCardLiteProps } from '@/types/monitor';
import { Button, Card, CardBody, Chip, Tooltip } from '@heroui/react';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import { AlertCircle, CheckCircle2, LayoutGrid, MinusCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { ResponsStats } from './charts/ResponsStats';
import { StatusBlockIndicator } from './charts/StatusBlockIndicator';

export function MonitorCardLite({
  monitor,
  heartbeats,
  uptime24h,
  isHome = true,
  onToggleView,
  disableViewToggle = false,
  pageId,
}: MonitorCardLiteProps) {
  const router = useRouter();
  const lastHeartbeat = heartbeats[heartbeats.length - 1];
  const status = lastHeartbeat?.status ?? 0;
  const chartColor = status === 1 ? 'success' : status === 2 ? 'warning' : 'danger';
  const StatusIcon = status === 1 ? CheckCircle2 : status === 2 ? MinusCircle : AlertCircle;
  const t = useTranslations('');

  const uptimeData = [
    {
      value: uptime24h * 100,
      fill: uptime24h > 0.98 ? '#17c964' : uptime24h > 0.9 ? '#f5a524' : '#f31260',
    },
  ];

  const handleClick = () => {
    if (isHome) {
      const pageIdToUse = pageId || apiConfig.defaultPageId;
      router.push(`/monitor/${monitor.id}?pageId=${pageIdToUse}`);
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
              <StatusIcon className={`text-${chartColor} h-5 w-5 flex-shrink-0`} />
              <h3 className="font-semibold truncate overflow-ellipsis">{monitor.name}</h3>

              {monitor.tags && monitor.tags.length > 0 && (
                <div className="flex-wrap gap-1 ml-2 hidden sm:flex">
                  {monitor.tags.slice(0, 2).map((tag) => (
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
                    </Chip>
                  ))}
                  {monitor.tags.length > 2 && (
                    <Chip size="sm" variant="flat" className="h-5">
                      +{monitor.tags.length - 2}
                    </Chip>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="flex-shrink-0">
                <ResponsStats
                  value={uptimeData[0].value}
                  fill={uptimeData[0].fill}
                  isHome={isHome}
                  size="sm"
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
