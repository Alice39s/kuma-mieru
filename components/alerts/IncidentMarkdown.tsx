'use client';

import { Alert } from '@/components/ui/Alert';
import type { Incident } from '@/types/monitor';
import { useFormatter, useTranslations } from 'next-intl';
import type { DateTimeFormatOptions } from 'next-intl';
import React, { useMemo } from 'react';
import { dateStringToTimestamp, extractSentence, timezoneOffsetToMs } from '../utils/format';
import { getMarkdownClasses, useMarkdown } from '../utils/markdown';

function IncidentMarkdownAlert({ incident }: { incident: Incident }) {
  const t = useTranslations('alert');
  const format = useFormatter();
  const now = Date.now();
  const dateTimeFormat: DateTimeFormatOptions = {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  };

  let { style, title, content, createdDate, lastUpdatedDate } = incident;

  createdDate = createdDate ? `${createdDate} +00:00` : '';
  lastUpdatedDate = lastUpdatedDate ? `${lastUpdatedDate} +00:00` : '';

  const alertColor = useMemo(() => {
    switch (style) {
      case 'info':
        return 'primary';
      case 'warning':
        return 'warning';
      case 'danger':
        return 'danger';
      case 'light':
        return 'default';
      case 'dark':
        return 'secondary';
      default:
        return 'primary';
    }
  }, [style]);

  const htmlContent = useMarkdown(content);

  return (
    <Alert
      title={title}
      description={extractSentence(content)}
      color={alertColor}
      variant="flat"
      className="mb-8"
    >
      <div
        className={getMarkdownClasses()}
        // oxlint-disable-next-line react/no-danger -- 内容已通过 rehype-sanitize 白名单净化
        dangerouslySetInnerHTML={{ __html: htmlContent }}
      />
      <div className="flex flex-col items-end gap-1 mt-4">
        {lastUpdatedDate && (
          <span className="text-sm text-gray-400 dark:text-gray-500">
            {t('updatedAt', {
              time: format.relativeTime(dateStringToTimestamp(lastUpdatedDate), now),
            })}
          </span>
        )}
        <span className="text-sm text-gray-400 dark:text-gray-500">
          {t('createdAt', {
            time: format.dateTime(
              dateStringToTimestamp(createdDate) + timezoneOffsetToMs('+00:00'),
              dateTimeFormat
            ),
          })}
        </span>
      </div>
    </Alert>
  );
}

export default IncidentMarkdownAlert;
