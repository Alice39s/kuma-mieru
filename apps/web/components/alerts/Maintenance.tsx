'use client';

import { ExpandableAlert } from '@/components/alerts/ExpandableAlert';
import { extractPlainText, getMarkdownClasses, useMarkdown } from '@/components/utils/markdown';
import type { Maintenance } from '@/types/config';
import { Card, CardBody, Chip, Progress } from '@heroui/react';
import clsx from 'clsx';
import { AlertCircle, Calendar, Clock, Timer, Wrench } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import type { DateTimeFormatOptions } from 'next-intl';
import { useMemo } from 'react';
import { useMaintenanceTimeline } from './hooks/useMaintenanceTimeline';

function MaintenanceScheduleCard({
  isActive,
  timeline,
  statusTitle,
}: {
  isActive: boolean;
  timeline: ReturnType<typeof useMaintenanceTimeline>;
  statusTitle: string;
}) {
  const t = useTranslations('maintenance');
  const format = useFormatter();
  const now = Date.now();
  const dateTimeFormat: DateTimeFormatOptions = {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  };

  if (!timeline) return null;

  const cardTone = isActive
    ? 'border-amber-200 dark:border-amber-800 bg-linear-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30'
    : 'border-blue-200 dark:border-blue-800 bg-linear-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30';

  return (
    <Card className={clsx('border', cardTone)}>
      <CardBody className="p-4">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {isActive ? (
              <Timer className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            ) : (
              <Clock className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            )}
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
              {statusTitle}
            </span>
          </div>
          {isActive ? (
            <Chip size="sm" color="warning" variant="flat">
              {timeline.progressPercent}%
            </Chip>
          ) : null}
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600 dark:text-gray-300">
            <div className="flex items-center gap-1.5">
              <Calendar className="h-4 w-4" />
              <span>{format.dateTime(timeline.displayStartTime, dateTimeFormat)}</span>
            </div>
            <span>-</span>
            <div className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
              <span>{format.dateTime(timeline.displayEndTime, dateTimeFormat)}</span>
            </div>
          </div>

          {isActive ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
                  {t('Progress')}
                </span>
                <span className="text-sm text-amber-700 dark:text-amber-300">
                  {t('EndsIn', {
                    time: format.relativeTime(timeline.endTime, now),
                  })}
                </span>
              </div>
              <Progress value={timeline.progressPercent} color="warning" className="h-3" />
            </div>
          ) : (
            <div className="pt-1 text-sm font-medium text-blue-600 dark:text-blue-400">
              {t('StartsIn', {
                time: format.relativeTime(timeline.startTime, now),
              })}
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function MaintenanceAlert({ maintenance }: { maintenance: Maintenance }) {
  const t = useTranslations('maintenance');
  const format = useFormatter();
  const now = Date.now();
  const dateTimeFormat: DateTimeFormatOptions = {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  };

  const isActive = maintenance.status === 'under-maintenance';
  const isScheduled = maintenance.status === 'scheduled';
  const renderedDescription = useMarkdown(maintenance.description || '');

  const timeline = useMaintenanceTimeline(maintenance, now);

  const statusText = useMemo(() => {
    if (isActive) return t('InProgress');
    if (isScheduled) return t('Scheduled');
    return t('default');
  }, [isActive, isScheduled, t]);

  const statusTitle = `${statusText}: ${maintenance.title}`;
  const alertColor = isActive ? 'warning' : 'default';
  const StatusIcon = isActive ? Wrench : AlertCircle;

  const previewText = maintenance.description
    ? extractPlainText(maintenance.description, 150)
    : timeline
      ? `${format.dateTime(timeline.displayStartTime, dateTimeFormat)} - ${format.dateTime(timeline.displayEndTime, dateTimeFormat)}`
      : '';

  return (
    <ExpandableAlert
      title={statusTitle}
      preview={previewText}
      color={alertColor}
      className="mb-8"
      icon={<StatusIcon className="h-4 w-4" />}
    >
      <div className="space-y-4">
        <MaintenanceScheduleCard isActive={isActive} timeline={timeline} statusTitle={statusText} />

        {maintenance.description && renderedDescription ? (
          <Card className="border border-gray-200/80 bg-white/70 dark:border-gray-700/70 dark:bg-zinc-900/60">
            <CardBody className="p-4">
              <div
                className={getMarkdownClasses()}
                // oxlint-disable-next-line react/no-danger -- 内容已通过 rehype-sanitize 白名单净化
                dangerouslySetInnerHTML={{ __html: renderedDescription }}
              />
            </CardBody>
          </Card>
        ) : null}

        <div className="flex items-center justify-end border-t border-gray-200/80 pt-3 text-sm text-gray-500 dark:border-gray-700/70 dark:text-gray-400">
          {t('timezoneInfo', {
            timezone: maintenance.timezoneOffset || 'UTC',
          })}
        </div>
      </div>
    </ExpandableAlert>
  );
}

export default MaintenanceAlert;
