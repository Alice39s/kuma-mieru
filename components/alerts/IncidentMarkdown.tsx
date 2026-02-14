'use client';

import { ExpandableAlert } from '@/components/alerts/ExpandableAlert';
import type { Incident } from '@/types/monitor';
import { CircleAlert, Info, TriangleAlert } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import type { DateTimeFormatOptions } from 'next-intl';
import { useMemo } from 'react';
import { dateStringToTimestamp, timezoneOffsetToMs } from '../utils/format';
import { extractPlainText, getMarkdownClasses, useMarkdown } from '../utils/markdown';

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

  const AlertIcon = useMemo(() => {
    switch (style) {
      case 'warning':
        return TriangleAlert;
      case 'danger':
        return CircleAlert;
      default:
        return Info;
    }
  }, [style]);

  const htmlContent = useMarkdown(content);

  return (
    <ExpandableAlert
      title={title}
      preview={extractPlainText(content, 150)}
      color={alertColor}
      className="mb-8"
      icon={<AlertIcon className="h-4 w-4" />}
    >
      <div className="space-y-4">
        <div
          className={getMarkdownClasses()}
          // oxlint-disable-next-line react/no-danger -- 内容已通过 rehype-sanitize 白名单净化
          dangerouslySetInnerHTML={{ __html: htmlContent }}
        />

        <div className="flex flex-col items-end gap-1 border-t border-gray-200/80 pt-3 dark:border-gray-700/70">
          {lastUpdatedDate ? (
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {t('updatedAt', {
                time: format.relativeTime(dateStringToTimestamp(lastUpdatedDate), now),
              })}
            </span>
          ) : null}
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {t('createdAt', {
              time: format.dateTime(
                dateStringToTimestamp(createdDate) + timezoneOffsetToMs('+00:00'),
                dateTimeFormat
              ),
            })}
          </span>
        </div>
      </div>
    </ExpandableAlert>
  );
}

export default IncidentMarkdownAlert;
