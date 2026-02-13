'use client';

import AutoRefresh from '@/components/AutoRefresh';
import FilterResults from '@/components/FilterResults';
import MonitorGroupList from '@/components/MonitorGroupList';
import IncidentMarkdownAlert from '@/components/alerts/IncidentMarkdown';
import MaintenanceAlert from '@/components/alerts/Maintenance';
import SystemStatusAlert from '@/components/alerts/SystemStatus';
import { useNodeSearch } from '@/components/context/NodeSearchContext';
import { usePageConfig } from '@/components/context/PageConfigContext';
import {
  revalidateData,
  useConfig,
  useMaintenanceData,
  useMonitorData,
} from '@/components/utils/swr';
import type { Monitor, MonitorGroup } from '@/types/monitor';
import { filterMonitorByStatus } from '@/utils/monitorFilters';
import { Button, Tooltip } from '@heroui/react';
import { LayoutGrid, LayoutList } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useEffect, useMemo, useRef, useState } from 'react';

const GLOBAL_VIEW_PREFERENCE_KEY = 'view-preference';

interface EnhancedMonitorGroup extends MonitorGroup {
  isGroupMatched?: boolean;
  monitorList: Monitor[];
}

export function StatusPage() {
  const { config: globalConfig, isLoading: isLoadingConfig } = useConfig();
  const { maintenanceList, isLoading: isLoadingMaintenance } = useMaintenanceData();
  const { monitorGroups, monitoringData, isLoading: isLoadingMonitors } = useMonitorData();
  const { searchTerm, isFiltering, clearSearch, filterStatus, searchInGroup } = useNodeSearch();
  const currentPageConfig = usePageConfig();
  const { setTheme } = useTheme();

  const [isGlobalLiteView, setIsGlobalLiteView] = useState(false);

  const t = useTranslations();
  const viewT = useTranslations('view');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedPreference = localStorage.getItem(GLOBAL_VIEW_PREFERENCE_KEY);
      if (savedPreference === 'lite') {
        setIsGlobalLiteView(true);
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(GLOBAL_VIEW_PREFERENCE_KEY, isGlobalLiteView ? 'lite' : 'full');
    }
  }, [isGlobalLiteView]);

  const isLoading = isLoadingMonitors || isLoadingConfig || isLoadingMaintenance;

  const activeMaintenances = maintenanceList.filter(
    (m) => m.active && (m.status === 'under-maintenance' || m.status === 'scheduled'),
  );

  const handleRefresh = async () => {
    await revalidateData(currentPageConfig.pageId);
  };

  const toggleGlobalView = () => {
    setIsGlobalLiteView((prev) => !prev);
  };

  const filteredMonitorGroups = useMemo(() => {
    if (!isFiltering) return monitorGroups as EnhancedMonitorGroup[];

    const searchTermLower = searchTerm.toLowerCase();
    const hasSearchTerm = searchTermLower.length > 0;

    const statusFilter = (monitor: Monitor) =>
      filterMonitorByStatus(monitor, filterStatus, monitoringData.heartbeatList);

    return monitorGroups
      .map((group) => {
        const groupNameMatches =
          searchInGroup && hasSearchTerm && group.name.toLowerCase().includes(searchTermLower);

        if (groupNameMatches) {
          const statusFilteredMonitors = group.monitorList.filter(statusFilter);
          return {
            ...group,
            monitorList: statusFilteredMonitors,
            isGroupMatched: true,
          };
        }

        const filteredMonitors = group.monitorList.filter((monitor) => {
          if (!statusFilter(monitor)) return false;

          if (!hasSearchTerm) return true;

          return (
            monitor.name.toLowerCase().includes(searchTermLower) ||
            monitor.url?.toLowerCase().includes(searchTermLower) ||
            monitor.tags?.some(
              (tag) =>
                tag.name.toLowerCase().includes(searchTermLower) ||
                tag.value?.toLowerCase().includes(searchTermLower),
            )
          );
        });

        if (filteredMonitors.length === 0) return null;

        return {
          ...group,
          monitorList: filteredMonitors,
          isGroupMatched: false,
        };
      })
      .filter(Boolean) as EnhancedMonitorGroup[];
  }, [
    monitorGroups,
    searchTerm,
    isFiltering,
    filterStatus,
    searchInGroup,
    monitoringData.heartbeatList,
  ]);

  const matchedMonitorsCount = useMemo(() => {
    if (!isFiltering) return 0;

    return filteredMonitorGroups.reduce((total, group) => {
      return total + group.monitorList.length;
    }, 0);
  }, [filteredMonitorGroups, isFiltering]);

  const lastPageIdRef = useRef(currentPageConfig.pageId);

  useEffect(() => {
    if (lastPageIdRef.current !== currentPageConfig.pageId) {
      lastPageIdRef.current = currentPageConfig.pageId;
      void revalidateData(currentPageConfig.pageId);
    }
  }, [currentPageConfig.pageId]);

  return (
    <AutoRefresh onRefresh={handleRefresh} interval={60000}>
      <div className="mx-auto max-w-(--breakpoint-2xl) px-4 py-8 pt-4">
        <div className="flex justify-between items-center mb-6" suppressHydrationWarning={true}>
          <SystemStatusAlert />
          <Tooltip
            content={isGlobalLiteView ? viewT('switchToFull') : viewT('switchToLite')}
            suppressHydrationWarning={true}
          >
            <Button
              isIconOnly
              variant="light"
              onPress={toggleGlobalView}
              className="ml-2"
              aria-label={isGlobalLiteView ? viewT('switchToFull') : viewT('switchToLite')}
              suppressHydrationWarning={true}
            >
              {isGlobalLiteView ? <LayoutGrid size={20} /> : <LayoutList size={20} />}
            </Button>
          </Tooltip>
        </div>

        {activeMaintenances.map((maintenance) => (
          <MaintenanceAlert key={maintenance.id} maintenance={maintenance} />
        ))}

        {globalConfig?.incident && <IncidentMarkdownAlert incident={globalConfig.incident} />}

        <FilterResults matchedMonitorsCount={matchedMonitorsCount} />

        <MonitorGroupList
          isLoading={isLoading}
          monitorGroups={filteredMonitorGroups}
          monitoringData={monitoringData}
          isFiltering={isFiltering}
          isGlobalLiteView={isGlobalLiteView}
          clearSearch={clearSearch}
        />
      </div>
    </AutoRefresh>
  );
}
