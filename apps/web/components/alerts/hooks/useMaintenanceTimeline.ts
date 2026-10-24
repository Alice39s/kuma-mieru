import type { Maintenance } from '@/types/config';
import { dateStringToTimestamp, timezoneOffsetToMs } from '@/components/utils/format';
import { useMemo } from 'react';

export interface MaintenanceTimeline {
  timeZoneOffset: string;
  startTime: number;
  endTime: number;
  displayStartTime: number;
  displayEndTime: number;
  progressPercent: number;
}

export function useMaintenanceTimeline(
  maintenance: Maintenance,
  now: number
): MaintenanceTimeline | null {
  const currentTimeSlot = maintenance.timeslotList?.[0];

  return useMemo(() => {
    if (!currentTimeSlot) return null;

    const timeZoneOffset = maintenance.timezoneOffset || 'UTC';
    const startDate = currentTimeSlot.startDate;
    const endDate = currentTimeSlot.endDate;

    const startTime = dateStringToTimestamp(startDate, timeZoneOffset);
    const endTime = dateStringToTimestamp(endDate, timeZoneOffset);
    const timezoneOffsetMs = timezoneOffsetToMs(timeZoneOffset);

    const duration = Math.max(endTime - startTime, 1);
    const elapsed = now - startTime;
    const progressPercent = Math.min(Math.max(Math.floor((elapsed / duration) * 100), 0), 100);

    return {
      timeZoneOffset,
      startTime,
      endTime,
      displayStartTime: startTime + timezoneOffsetMs,
      displayEndTime: endTime + timezoneOffsetMs,
      progressPercent,
    };
  }, [currentTimeSlot, maintenance.timezoneOffset, now]);
}
