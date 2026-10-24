import type { Heartbeat } from '@/types/monitor';
import { Tooltip as HeroUITooltip } from '@heroui/react';
import { clsx } from 'clsx';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { calculatePingMetrics } from '../utils/charts';
import { getPingColorClass } from '../utils/colors';
import { formatLatency } from '../utils/format';

interface PingStatsProps {
  heartbeats: Heartbeat[];
  isHome?: boolean;
}

const PING_LABELS = {
  lt: {
    short: 'LT',
    full: 'latestPing',
  },
  av: {
    short: 'AL',
    full: 'avgPing',
  },
  ta: {
    short: 'TR',
    full: 'trimmedAvgPing',
  },
} as const;

interface SinglePingStatProps {
  label: (typeof PING_LABELS)[keyof typeof PING_LABELS];
  value: number;
  isHome?: boolean;
  t: ReturnType<typeof useTranslations>;
}

const SinglePingStat = ({ label, value, isHome, t }: SinglePingStatProps) => {
  return (
    <div className="flex items-center gap-0.5">
      {isHome ? (
        <HeroUITooltip content={t(label.full)}>
          <span>{label.short}</span>
        </HeroUITooltip>
      ) : (
        t(label.full)
      )}
      :
      <span className={clsx('font-medium', getPingColorClass(value).text)}>
        {formatLatency(value)}
      </span>
    </div>
  );
};

export function PingStats({ heartbeats, isHome = false }: PingStatsProps) {
  const t = useTranslations('node');
  const stats = useMemo(() => calculatePingMetrics(heartbeats), [heartbeats]);

  if (!stats) return null;

  return (
    <div className="hide-ping-stats ml-1 flex items-center gap-1.5 text-xs text-foreground/80 dark:text-foreground/60">
      <SinglePingStat label={PING_LABELS.lt} value={stats.latestPing} isHome={isHome} t={t} />
      <SinglePingStat label={PING_LABELS.av} value={stats.avgPing} isHome={isHome} t={t} />
      {!isHome && (
        <SinglePingStat label={PING_LABELS.ta} value={stats.trimmedAvgPing} isHome={isHome} t={t} />
      )}
    </div>
  );
}
