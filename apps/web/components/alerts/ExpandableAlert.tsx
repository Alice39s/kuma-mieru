'use client';

import clsx from 'clsx';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';

type AlertTone = 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger';

interface ExpandableAlertProps {
  title: string;
  preview?: string;
  color?: AlertTone;
  className?: string;
  icon?: ReactNode;
  children: ReactNode;
}

const toneClassMap: Record<AlertTone, string> = {
  default:
    'border-gray-200/80 bg-white/90 text-gray-900 dark:border-gray-700/80 dark:bg-zinc-900/80 dark:text-gray-100',
  primary:
    'border-blue-200/80 bg-blue-50/80 text-blue-950 dark:border-blue-800/70 dark:bg-blue-950/35 dark:text-blue-100',
  secondary:
    'border-violet-200/80 bg-violet-50/80 text-violet-950 dark:border-violet-800/70 dark:bg-violet-950/35 dark:text-violet-100',
  success:
    'border-emerald-200/80 bg-emerald-50/80 text-emerald-950 dark:border-emerald-800/70 dark:bg-emerald-950/35 dark:text-emerald-100',
  warning:
    'border-amber-200/80 bg-amber-50/80 text-amber-950 dark:border-amber-800/70 dark:bg-amber-950/35 dark:text-amber-100',
  danger:
    'border-rose-200/80 bg-rose-50/80 text-rose-950 dark:border-rose-800/70 dark:bg-rose-950/35 dark:text-rose-100',
};

const iconClassMap: Record<AlertTone, string> = {
  default: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  primary: 'bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300',
  secondary: 'bg-violet-100 text-violet-700 dark:bg-violet-900/60 dark:text-violet-300',
  success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300',
  danger: 'bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-300',
};

export function ExpandableAlert({
  title,
  preview,
  color = 'default',
  className,
  icon,
  children,
}: ExpandableAlertProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [hasEverExpanded, setHasEverExpanded] = useState(false);
  const contentId = useId();

  const handleToggle = () => {
    setIsExpanded(prev => {
      const nextExpanded = !prev;
      if (nextExpanded) {
        setHasEverExpanded(true);
      }
      return nextExpanded;
    });
  };

  return (
    <div
      className={clsx(
        'w-full overflow-hidden rounded-xl border shadow-xs',
        toneClassMap[color],
        className
      )}
    >
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={isExpanded}
        aria-controls={contentId}
        className="w-full cursor-pointer px-4 py-3 text-left"
      >
        <div className={clsx('flex w-full items-start', isExpanded ? 'gap-2' : 'gap-3')}>
          {!isExpanded && icon ? (
            <div
              className={clsx(
                'mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                iconClassMap[color]
              )}
            >
              {icon}
            </div>
          ) : null}

          <div className="min-w-0 flex-1">
            <h5 className={clsx('truncate font-semibold', isExpanded ? 'text-base' : 'text-sm')}>
              {title}
            </h5>
            {!isExpanded && preview ? (
              <p className="mt-1 line-clamp-2 text-sm text-gray-600 dark:text-gray-300">
                {preview}
              </p>
            ) : null}
          </div>

          <div className="ml-2 mt-0.5 shrink-0 text-gray-500 dark:text-gray-400">
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </div>
      </button>

      <div
        className={clsx(
          'grid transition-[grid-template-rows,opacity] duration-200 ease-in-out',
          isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        )}
      >
        <div
          id={contentId}
          role="region"
          aria-hidden={!isExpanded}
          inert={!isExpanded}
          className="overflow-hidden"
        >
          <div className="border-t border-black/8 px-4 pb-4 pt-4 dark:border-white/8">
            {hasEverExpanded ? children : null}
          </div>
        </div>
      </div>
    </div>
  );
}
