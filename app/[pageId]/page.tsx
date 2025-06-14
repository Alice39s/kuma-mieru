'use client';

import AutoRefresh from '@/components/AutoRefresh';
import FilterResults from '@/components/FilterResults';
import MonitorGroupList from '@/components/MonitorGroupList';
import IncidentMarkdownAlert from '@/components/alerts/IncidentMarkdown';
import MaintenanceAlert from '@/components/alerts/Maintenance';
import SystemStatusAlert from '@/components/alerts/SystemStatus';
import { useNodeSearch } from '@/components/context/NodeSearchContext';
import {
  revalidateData,
  useConfig,
  useMaintenanceData,
  useMonitorData,
} from '@/components/utils/swr';
import { getConfigForPage } from '@/config/api';
import { filterMonitorByStatus } from '@/utils/monitorFilters';
import { Button, Tooltip } from '@heroui/react';
import { LayoutGrid, LayoutList } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import type { Monitor, MonitorGroup } from '@/types/monitor';

const GLOBAL_VIEW_PREFERENCE_KEY = 'view-preference';

interface EnhancedMonitorGroup extends MonitorGroup {
  isGroupMatched?: boolean;
  monitorList: Monitor[];
}

export default function StatusPage() {
  const params = useParams();
  const pageId = params.pageId as string;

  // 设置当前页面配置
  const pageConfig = getConfigForPage(pageId);

  const {
    monitorGroups,
    monitoringData,
    isLoading: isLoadingMonitors,
    revalidate: revalidateMonitors,
  } = useMonitorData(pageId);
  const { config: globalConfig, isLoading: isLoadingConfig } = useConfig(pageId);
  const { maintenanceList, isLoading: isLoadingMaintenance } = useMaintenanceData(pageId);
  const [isGlobalLiteView, setIsGlobalLiteView] = useState(false);
  const { searchTerm, isFiltering, clearSearch, filterStatus, searchInGroup } = useNodeSearch();

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

  const isLoading = isLoadingMonitors || isLoadingConfig || isLoadingMaintenance;

  // Filter active maintenance plans
  const activeMaintenances = maintenanceList.filter(
    (m) => m.active && (m.status === 'under-maintenance' || m.status === 'scheduled'),
  );

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(GLOBAL_VIEW_PREFERENCE_KEY, isGlobalLiteView ? 'lite' : 'full');
    }
  }, [isGlobalLiteView]);

  const handleRefresh = async () => {
    await revalidateData(pageId);
  };

  const toggleGlobalView = () => {
    setIsGlobalLiteView((prev) => !prev);
  };

  const filteredMonitorGroups = useMemo(() => {
    if (!isFiltering) return monitorGroups as EnhancedMonitorGroup[];

    const searchTermLower = searchTerm.toLowerCase();
    const hasSearchTerm = searchTermLower.length > 0;

    // pre-filter by status
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

  return (
    <>
      <AutoRefresh onRefresh={handleRefresh} interval={60000}>
        <div className="mx-auto max-w-screen-2xl px-4 py-8 pt-4">
          {/* 状态总览 */}
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

          {/* 维护计划显示 */}
          {activeMaintenances.map((maintenance) => (
            <MaintenanceAlert key={maintenance.id} maintenance={maintenance} />
          ))}

          {/* 公告显示 */}
          {globalConfig?.incident && <IncidentMarkdownAlert incident={globalConfig.incident} />}

          {/* 搜索筛选提示 */}
          <FilterResults matchedMonitorsCount={matchedMonitorsCount} />

          {/* 监控组和监控项 */}
          <MonitorGroupList
            isLoading={isLoading}
            monitorGroups={filteredMonitorGroups}
            monitoringData={monitoringData}
            isFiltering={isFiltering}
            isGlobalLiteView={isGlobalLiteView}
            clearSearch={clearSearch}
            pageId={pageId}
          />
        </div>
      </AutoRefresh>
    </>
  );
}
