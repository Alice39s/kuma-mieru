import type { CSSProperties } from 'react';

/**
 * The brand decoration (design.md「心跳条」): a fixed run of heartbeat bars in the dashboard's status colours. It is
 * decoration only, so the pattern is a fixed sequence and the strip is hidden from assistive technology.
 */
const PATTERN = [
  'up',
  'up',
  'up',
  'good',
  'up',
  'up',
  'up',
  'up',
  'fair',
  'up',
  'up',
  'up',
  'up',
  'pending',
  'up',
  'up',
  'good',
  'up',
  'up',
  'up',
  'up',
  'up',
  'down',
  'up',
  'up',
  'up',
  'good',
  'up',
  'up',
  'up',
  'maintenance',
  'up',
  'up',
  'up',
  'up',
  'fair',
  'up',
  'up',
  'up',
  'up',
] as const;

type Beat = (typeof PATTERN)[number];

const beatClass: Record<Beat, string> = {
  up: 'bg-success',
  good: 'bg-success/80',
  fair: 'bg-success/60',
  pending: 'bg-warning',
  down: 'bg-fd-error',
  maintenance: 'bg-fd-primary/60',
};

interface HeartbeatStripProps {
  /** How many bars to draw, counted from the newest. */
  count?: number;
  className?: string;
  style?: CSSProperties;
}

export function HeartbeatStrip({ count = PATTERN.length, className, style }: HeartbeatStripProps) {
  const beats = PATTERN.slice(-count);
  return (
    <div aria-hidden="true" className={`km-heartbeat ${className ?? ''}`} style={style}>
      {beats.map((beat, index) => (
        <span key={`${index}-${beat}`} className={beatClass[beat]} />
      ))}
    </div>
  );
}
