import type { Heartbeat } from '@/types/monitor';
import { Tab, Tabs } from '@heroui/react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Key as ReactKey } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartTooltip } from '../ui/ChartTooltip';
import { formatLatencyForAxis, getLatencyColor } from '../utils/format';

interface MonitoringChartProps {
  heartbeats: Heartbeat[];
  height?: number;
  showGrid?: boolean;
  color?: 'success' | 'warning' | 'danger' | 'primary' | 'default';
  defaultRange?: '100-points' | '50-points' | '25-points' | '10-points';
}

type RangeKey = NonNullable<MonitoringChartProps['defaultRange']>;

const countRanges = [
  { key: '100-points', count: 100 },
  { key: '50-points', count: 50 },
  { key: '25-points', count: 25 },
  { key: '10-points', count: 10 },
];

const resolveAvailableRange = (range: RangeKey, ranges: typeof countRanges): RangeKey =>
  ranges.some(item => item.key === range) ? range : '50-points';

function SimplifiedChart({
  data,
  height,
  color,
  showGrid,
  minPing,
  maxPing,
}: {
  data: Array<{ time: number; ping: number }>;
  height: number;
  color: string;
  showGrid: boolean;
  minPing: number;
  maxPing: number;
}) {
  return (
    <div className="w-full h-full" style={{ height }}>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart
          data={data}
          margin={{ top: 5, right: 5, left: 5, bottom: 5 }}
          className="[&_.recharts-surface]:outline-none"
        >
          <defs>
            <linearGradient id="colorGradient" x1="0" x2="0" y1="0" y2="1">
              <stop offset="10%" stopColor={`hsl(var(--heroui-${color}-500))`} stopOpacity={0.5} />
              <stop offset="100%" stopColor={`hsl(var(--heroui-${color}-100))`} stopOpacity={0.1} />
            </linearGradient>
          </defs>
          {showGrid && (
            <CartesianGrid
              stroke="hsl(var(--heroui-default-200))"
              strokeDasharray="3 3"
              vertical={false}
            />
          )}
          <XAxis
            dataKey="time"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(time: number) => new Date(time).toLocaleTimeString()}
            axisLine={false}
            tickLine={false}
            minTickGap={30}
            interval="preserveStartEnd"
            style={{
              fontSize: 'var(--heroui-font-size-tiny)',
            }}
          />
          <YAxis
            domain={[minPing, maxPing]}
            hide={!showGrid}
            width={60}
            axisLine={false}
            tickLine={false}
            style={{
              fontSize: 'var(--heroui-font-size-tiny)',
            }}
            tickFormatter={formatLatencyForAxis}
            dx={-10}
          />
          <Tooltip
            content={<ChartTooltip />}
            cursor={{
              strokeWidth: 0,
            }}
          />
          <Area
            type="monotone"
            dataKey="ping"
            stroke={`hsl(var(--heroui-${color}))`}
            strokeWidth={2}
            fill="url(#colorGradient)"
            connectNulls
            activeDot={{
              stroke: `hsl(var(--heroui-${color}))`,
              strokeWidth: 2,
              fill: 'hsl(var(--heroui-background))',
              r: 5,
            }}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MonitoringChart({
  heartbeats,
  height = 200,
  showGrid = false,
  color = 'default',
  defaultRange = '50-points',
}: MonitoringChartProps) {
  const t = useTranslations();
  const [chartReady, setChartReady] = useState(false);
  const chartContainerRef = useRef<HTMLDivElement>(null);

  const availableRanges = useMemo(
    () => countRanges.filter(range => range.key !== '100-points' || heartbeats.length >= 100),
    [heartbeats.length]
  );

  const [rangeState, setRangeState] = useState(() => ({
    heartbeatCount: heartbeats.length,
    defaultRange,
    selectedRange: resolveAvailableRange(defaultRange, availableRanges),
  }));

  // Reset the selection while rendering whenever the data size or the default range changes.
  if (rangeState.heartbeatCount !== heartbeats.length || rangeState.defaultRange !== defaultRange) {
    setRangeState({
      heartbeatCount: heartbeats.length,
      defaultRange,
      selectedRange: resolveAvailableRange(defaultRange, availableRanges),
    });
  }

  const { selectedRange } = rangeState;

  useEffect(() => {
    let mounted = true;

    const timer = setTimeout(() => {
      if (mounted) {
        requestAnimationFrame(() => {
          if (mounted) {
            setChartReady(true);
          }
        });
      }
    }, 200);

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, []);

  const filteredData = useMemo(() => {
    if (!heartbeats || !Array.isArray(heartbeats)) return [];

    const count = availableRanges.find(r => r.key === selectedRange)?.count || 50;

    return heartbeats
      .slice(-count)
      .filter(hb => hb && typeof hb.ping === 'number' && !Number.isNaN(hb.ping))
      .map(hb => ({
        time: new Date(hb.time).getTime(),
        ping: hb.ping || 0,
        status: hb.status,
        color: getLatencyColor(hb.ping || 0),
      }));
  }, [availableRanges, heartbeats, selectedRange]);

  const pings = filteredData.map(d => d.ping).filter(p => p > 0 && !Number.isNaN(p));
  const minPing = pings.length > 0 ? Math.max(0, Math.min(...pings) - 10) : 0;
  const maxPing = pings.length > 0 ? Math.max(...pings) + 10 : 100;

  const handleRangeChange = useCallback((key: ReactKey) => {
    setRangeState(previous => ({ ...previous, selectedRange: key as RangeKey }));
  }, []);

  if (!filteredData.length) {
    return (
      <div className="w-full h-50 flex items-center justify-center text-default-500">
        {t('noData')}
      </div>
    );
  }

  const chartHeight = typeof height === 'number' && height > 0 ? height : 200;

  return (
    <div
      className="w-full mt-2 group-data-[glass-cards=true]/appearance:min-w-0"
      ref={chartContainerRef}
    >
      <div className="mb-4 mt-3 items-center justify-center flex gap-2 group-data-[glass-cards=true]/appearance:justify-start group-data-[glass-cards=true]/appearance:overflow-x-auto">
        <Tabs
          size="sm"
          selectedKey={selectedRange}
          onSelectionChange={handleRangeChange}
          className="font-light text-sm"
        >
          {availableRanges.map(range => (
            <Tab key={range.key} title={t('node.count', { count: range.count })} />
          ))}
        </Tabs>
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={selectedRange}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{
            duration: 0.4,
            ease: [0.4, 0, 0.2, 1],
          }}
          className="w-full"
          style={{ minHeight: chartHeight, height: chartHeight }}
        >
          {chartReady ? (
            <SimplifiedChart
              data={filteredData}
              height={chartHeight}
              color={color}
              showGrid={showGrid}
              minPing={minPing}
              maxPing={maxPing}
            />
          ) : (
            <div className="w-full" style={{ height: `${chartHeight}px` }} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
