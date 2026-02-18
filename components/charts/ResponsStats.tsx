import { Tooltip as HeroUITooltip } from '@heroui/react';
import { clsx } from 'clsx';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from 'recharts';

interface ResponsStatsProps {
  value: number;
  fill: string;
  isHome?: boolean;
  size?: 'sm' | 'md' | 'lg';
  valueClassName?: string;
}

const TOOLTIP_MOTION_PROPS = {
  variants: {
    exit: {
      opacity: 0,
      transition: {
        duration: 0.1,
        ease: 'easeOut',
      },
    },
    enter: {
      opacity: 1,
      transition: {
        duration: 0.15,
        ease: 'easeOut',
      },
    },
  },
} as const;

export function ResponsStats({
  value,
  fill,
  isHome,
  size = 'md',
  valueClassName,
}: ResponsStatsProps) {
  const t = useTranslations('node');
  const formattedValue = useMemo(() => value.toFixed(2), [value]);
  const data = useMemo(() => [{ value, fill }], [value, fill]);

  const tooltipContent = useMemo(() => {
    if (isHome) {
      return `${t('uptimeStatus')}: ${formattedValue}%`;
    }

    return (
      <div className="flex flex-col gap-2">
        <span className="text-md text-gray-500">
          {t('uptimeStatus')}: {formattedValue}%
        </span>
      </div>
    );
  }, [formattedValue, isHome, t]);

  const chartSize = size === 'sm' ? 'w-6 h-6' : size === 'lg' ? 'w-12 h-12' : 'w-10 h-10';
  const textSize = size === 'sm' ? 'text-xs' : size === 'lg' ? 'text-base' : 'text-sm';
  const barSize = size === 'sm' ? 6 : size === 'lg' ? 14 : 12;
  const gapClass = size === 'lg' ? 'gap-0.2' : 'gap-0.1';

  return (
    <HeroUITooltip
      content={tooltipContent}
      placement="left"
      delay={0}
      closeDelay={0}
      motionProps={TOOLTIP_MOTION_PROPS}
    >
      <div className={clsx('inline-flex items-center', gapClass)}>
        <div className={chartSize}>
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
              innerRadius="65%"
              outerRadius="100%"
              data={data}
              startAngle={90}
              endAngle={-270}
              barSize={barSize}
              cx="50%"
              cy="50%"
            >
              <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
              <RadialBar background dataKey="value" cornerRadius={30} fill={fill} />
            </RadialBarChart>
          </ResponsiveContainer>
        </div>
        <span className={clsx(textSize, valueClassName ?? 'text-gray-500')}>{formattedValue}%</span>
      </div>
    </HeroUITooltip>
  );
}
