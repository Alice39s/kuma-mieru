import { CircleCheck, CircleX, Info, Lightbulb, TriangleAlert } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';

/** design.md「提示框」: the dashboard's alert surface with its status colours. */
const tones = {
  info: { icon: Info, className: 'bg-fd-card [&>svg]:text-fd-primary' },
  idea: { icon: Lightbulb, className: 'bg-fd-card [&>svg]:text-fd-primary' },
  warning: {
    icon: TriangleAlert,
    className: 'border-fd-warning/40 bg-fd-warning/10 [&>svg]:text-fd-warning',
  },
  error: { icon: CircleX, className: 'border-fd-error/40 bg-fd-error/10 [&>svg]:text-fd-error' },
  success: { icon: CircleCheck, className: 'bg-fd-card [&>svg]:text-fd-success' },
} as const;

type Tone = keyof typeof tones;

interface CalloutProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Fumadocs' names; `warn` and `tip` are its aliases of `warning` and `info`. */
  type?: Tone | 'warn' | 'tip';
  title?: ReactNode;
  icon?: ReactNode;
}

function toneOf(type: NonNullable<CalloutProps['type']>): Tone {
  if (type === 'warn') return 'warning';
  if (type === 'tip') return 'info';
  return type;
}

export function Callout({
  type = 'info',
  title,
  icon,
  children,
  className,
  ...props
}: CalloutProps) {
  const tone = tones[toneOf(type)];
  const Icon = tone.icon;
  return (
    <div
      {...props}
      className={`my-5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-1 rounded-(--radius-card) border px-3.5 py-3 text-sm text-fd-card-foreground [&>svg]:row-span-2 [&>svg]:size-4 [&>svg]:translate-y-0.5 ${tone.className} ${className ?? ''}`}
    >
      {icon ?? <Icon aria-hidden="true" />}
      {title && <p className="col-start-2 my-0! font-semibold">{title}</p>}
      <div className="col-start-2 prose-no-margin text-fd-muted-foreground">{children}</div>
    </div>
  );
}
