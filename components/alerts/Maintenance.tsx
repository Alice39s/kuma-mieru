'use client';

import { Alert } from '@/components/ui/Alert';
import type { Maintenance } from '@/types/config';
import { Card, CardBody, Chip, Progress } from '@heroui/react';
import clsx from 'clsx';
import { AlertCircle, Calendar, Clock, Timer, Wrench } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import React, { useEffect } from 'react';
import { dateStringToTimestamp } from '../utils/format';
import { getMarkdownClasses, useMarkdown } from '../utils/markdown';

function MaintenanceAlert({ maintenance }: { maintenance: Maintenance }) {
  const t = useTranslations('maintenance');
  const format = useFormatter();
  const now = Date.now();

  const isActive = maintenance.status === 'under-maintenance';
  const isScheduled = maintenance.status === 'scheduled';

  // 渲染 description 的 markdown 内容
  const renderedDescription = useMarkdown(maintenance.description || '');

  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log('Maintenance data:', maintenance);
    }
  }, [maintenance]);

  const getStatusTitle = () => {
    if (isActive) {
      return t('InProgress');
    }
    if (isScheduled) {
      return t('Scheduled');
    }
    return t('default');
  };

  const getMaintenanceTimeInfo = () => {
    if (!maintenance.timeslotList || maintenance.timeslotList.length === 0) {
      return null;
    }

    // 从维护数据中获取时区信息
    const timeZoneOffset = maintenance.timezoneOffset || 'UTC';
    let { startDate, endDate } = maintenance.timeslotList[0];

    // 处理日期字符串，移除末尾的时区信息
    if (startDate.endsWith('+0000')) {
      startDate = startDate.replace(' +0000', '');
    }
    if (endDate.endsWith('+0000')) {
      endDate = endDate.replace(' +0000', '');
    }

    // 在开发环境中记录处理后的日期和时区信息
    if (process.env.NODE_ENV === 'development') {
      console.log('处理后的开始日期:', startDate);
      console.log('处理后的结束日期:', endDate);
      console.log('使用的时区:', timeZoneOffset);
    }

    const startTime = dateStringToTimestamp(startDate, timeZoneOffset);
    const endTime = dateStringToTimestamp(endDate, timeZoneOffset);

    // 在开发环境中记录转换后的时间戳
    if (process.env.NODE_ENV === 'development') {
      console.log('开始时间戳:', startTime, new Date(startTime).toISOString());
      console.log('结束时间戳:', endTime, new Date(endTime).toISOString());
    }

    if (isActive) {
      const totalDuration = endTime - startTime;
      const elapsed = now - startTime;
      const progressPercent = Math.min(
        Math.max(Math.floor((elapsed / totalDuration) * 100), 0),
        100,
      );

      return (
        <Card className="mt-4 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 border border-amber-200 dark:border-amber-800">
          <CardBody className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Timer className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              <span className="font-semibold text-amber-800 dark:text-amber-200">
                {t('maintenanceInProgress')}
              </span>
            </div>

            {/* 渲染 markdown description */}
            {maintenance.description && (
              <div
                className={clsx(
                  'my-4 w-full rounded-lg border border-amber-200/50 dark:border-amber-700/50 prose-amber prose-sm prose-p:m-0',
                  getMarkdownClasses(),
                )}
              >
                <div
                  className="prose-amber prose-sm prose-p:m-0 p-4"
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: 相信 markdown-it 的安全性
                  dangerouslySetInnerHTML={{ __html: renderedDescription }}
                />
              </div>
            )}

            <div className="space-y-3">
              <div className="flex justify-between items-center text-sm">
                <div className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                  <Calendar className="h-4 w-4" />
                  <span>{format.dateTime(startTime, 'normal')}</span>
                </div>
                <div className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                  <Clock className="h-4 w-4" />
                  <span>{format.dateTime(endTime, 'normal')}</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
                    {t('Progress')}
                  </span>
                  <Chip size="sm" color="warning" variant="flat">
                    {progressPercent}%
                  </Chip>
                </div>
                <Progress
                  value={progressPercent}
                  color="warning"
                  className="h-3"
                  aria-label={t('Progress')}
                />
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-amber-200 dark:border-amber-800">
                <span className="text-sm text-amber-600 dark:text-amber-400 font-medium">
                  {t('EndsIn', {
                    time: format.relativeTime(endTime, now),
                  })}
                </span>
              </div>
            </div>
          </CardBody>
        </Card>
      );
    }

    if (isScheduled) {
      return (
        <Card className="mt-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border border-blue-200 dark:border-blue-800">
          <CardBody className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <span className="font-semibold text-blue-800 dark:text-blue-200">
                {t('scheduledMaintenance')}
              </span>
            </div>

            {/* 渲染 markdown description */}
            {maintenance.description && (
              <div
                className={`${getMarkdownClasses()} mb-4 p-3 bg-white/50 dark:bg-black/20 rounded-lg border border-blue-200/50 dark:border-blue-700/50`}
                // biome-ignore lint/security/noDangerouslySetInnerHtml: 相信 markdown-it 的安全性
                dangerouslySetInnerHTML={{ __html: renderedDescription }}
              />
            )}

            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <Calendar className="h-4 w-4" />
                <span>{format.dateTime(startTime, 'normal')}</span>
                <span>-</span>
                <span>{format.dateTime(endTime, 'normal')}</span>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-blue-200 dark:border-blue-800">
                <span className="text-sm text-blue-600 dark:text-blue-400 font-medium">
                  {t('StartsIn', {
                    time: format.relativeTime(startTime, now),
                  })}
                </span>
              </div>
            </div>
          </CardBody>
        </Card>
      );
    }

    return null;
  };

  const alertColor = isActive ? 'warning' : 'default';
  const StatusIcon = isActive ? Wrench : AlertCircle;
  const statusTitle = `${getStatusTitle()}: ${maintenance.title}`;

  return (
    <Alert
      title={statusTitle}
      description={maintenance.description}
      color={alertColor}
      variant="flat"
      className="mb-8"
      icon={<StatusIcon className="h-5 w-5" />}
      markdownDescription={true}
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <StatusIcon className="h-5 w-5" />
          <span className="font-medium text-lg">{statusTitle}</span>
        </div>

        {getMaintenanceTimeInfo()}

        <div className="flex flex-col items-end gap-1 mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <span className="text-sm text-gray-400 dark:text-gray-500">
            {t('timezoneInfo', {
              timezone: maintenance.timezoneOffset || 'UTC',
            })}
          </span>
        </div>
      </div>
    </Alert>
  );
}

export default MaintenanceAlert;
