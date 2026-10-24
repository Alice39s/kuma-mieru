import dayjs from 'dayjs';
import { useTranslations } from 'next-intl';
import { formatLatency, getLatencyColor } from '../utils/format';

interface ChartTooltipProps {
  active?: boolean;
  payload?: Array<{
    value?: number;
    payload?: {
      status?: number;
      time?: string | number;
      ping?: number;
    };
  }>;
  label?: string | number;
}

export function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  const t = useTranslations();
  if (active && payload && payload.length) {
    const status = payload[0]?.payload?.status;

    let statusText: string;
    switch (status) {
      case 1:
        statusText = t('node.online');
        break;
      case 2:
        statusText = t('node.pending');
        break;
      case 3:
        statusText = t('node.maintenance');
        break;
      default: // 0
        statusText = t('node.offline');
    }

    let statusColor: string;
    switch (status) {
      case 1: // online
        statusColor = 'text-success';
        break;
      case 2: // pending
        statusColor = 'text-pending';
        break;
      case 3: // maintenance
        statusColor = 'text-danger';
        break;
      default: // 0, offline
        statusColor = 'text-danger';
    }

    const ping = payload[0]?.value;
    const latencyColor = getLatencyColor(ping || 0);

    const formattedDate = label
      ? (() => {
          try {
            const timestamp =
              typeof label === 'number' ? label : Number.parseInt(label.toString(), 10);
            return dayjs(timestamp).isValid()
              ? dayjs(timestamp).format('YYYY-MM-DD HH:mm:ss')
              : '错误的时间戳';
          } catch (e) {
            console.error('日期解析错误:', e);
            return '错误的时间戳';
          }
        })()
      : '';

    return (
      <div className="flex h-auto min-w-[140px] items-center gap-x-2 rounded-medium bg-content1 dark:bg-content2 p-2 text-tiny shadow-small">
        <div className="flex w-full flex-col gap-y-1">
          <div className="flex w-full items-center gap-x-2">
            <div className="flex w-full items-center gap-x-1 text-small">
              <span className={`text-small font-medium ${statusColor}`}>{statusText}</span>
              <span className="text-foreground-400">-</span>
              <span className={`text-${latencyColor}`}>{formatLatency(ping || 0)}</span>
            </div>
          </div>
          <span className="text-small font-medium text-foreground-400">{formattedDate}</span>
        </div>
      </div>
    );
  }
  return null;
}
