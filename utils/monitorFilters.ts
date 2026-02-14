import type { FilterStatus } from '@/components/context/NodeSearchContext';
import type { Monitor } from '@/types/monitor';
import type { HeartbeatData } from '@/types/monitor';

/**
 * Ffilter monitor by status (for search list)
 */
export const filterMonitorByStatus = (
  monitor: Monitor,
  filterStatus: FilterStatus,
  heartbeatList: HeartbeatData
) => {
  if (filterStatus === 'all') return true;

  const lastHeartbeat = heartbeatList[monitor.id]?.[heartbeatList[monitor.id]?.length - 1];

  if (!lastHeartbeat) return false;

  switch (filterStatus) {
    case 'up':
      return lastHeartbeat.status === 1;
    case 'down':
      return lastHeartbeat.status === 0;
    case 'pending':
      return lastHeartbeat.status === 2;
    case 'maintenance':
      return lastHeartbeat.status === 3;
    default:
      return true;
  }
};
