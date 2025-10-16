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
import { filterMonitorByStatus } from '@/utils/monitorFilters';
import { Button, Tooltip } from '@heroui/react';
import { LayoutGrid, LayoutList } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import type { Monitor, MonitorGroup } from '@/types/monitor';

const GLOBAL_VIEW_PREFERENCE_KEY = 'view-preference';

interface EnhancedMonitorGroup extends MonitorGroup {
  isGroupMatched?: boolean;
  monitorList: Monitor[];
}

export default function Home() {
  const {
    monitorGroups,
    monitoringData,
    isLoading: isLoadingMonitors,
    revalidate: revalidateMonitors,
  } = useMonitorData();
  const { config: globalConfig, isLoading: isLoadingConfig } = useConfig();
  const { maintenanceList, isLoading: isLoadingMaintenance } = useMaintenanceData();
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
    await revalidateData();
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
        <div className="mx-auto max-w-(--breakpoint-2xl) px-4 py-8 pt-4">
 {/* ===== 访问我的Uptime-Kuma ===== */}
<div className="w-full flex justify-center mb-2">
  <a
    href="https://bjlglhez.us-west-1.clawcloudrun.com/" // ← 改成你的链接
    target="_blank"
    rel="noopener noreferrer"
    aria-label="Kuma Mieru Link"
    className="top-link"
  >
    <span className="top-link-inner">🚀 访问我的Uptime-Kuma </span>
    <span className="top-link-underline" aria-hidden="true" />
  </a>
</div>

<style>{`
.top-link {
  position: relative;
  display: inline-block;
  padding: 10px 22px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.05);
  box-shadow: 0 0 12px rgba(0, 255, 255, 0.15), inset 0 0 10px rgba(0, 255, 255, 0.08);
  text-decoration: none;
  transition: all 0.3s ease;
  overflow: hidden;
  backdrop-filter: blur(6px);
}

.top-link-inner {
  font-weight: 700;
  font-size: 18px;
  letter-spacing: 0.5px;
  color: #ffffff;
  background: linear-gradient(90deg, #4deeea, #74f9ff, #a6fff2, #4deeea);
  background-size: 300% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  text-shadow: 0 0 10px rgba(77,238,234,0.6);
  animation: glowShift 4s linear infinite;
}

.top-link-underline {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 100%;
  height: 2px;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(0,255,255,0.9), rgba(0,150,255,0.8), rgba(0,255,150,0.8));
  filter: blur(4px);
  opacity: 0.9;
  transform: scaleX(0);
  transition: transform 0.4s ease, opacity 0.4s ease;
  transform-origin: left;
}

/* Hover 效果：浮起、放光、能量线滑过 */
.top-link:hover {
  transform: translateY(-4px) scale(1.02);
  box-shadow:
    0 0 20px rgba(0, 255, 255, 0.5),
    0 0 50px rgba(0, 200, 255, 0.2),
    inset 0 0 20px rgba(0, 255, 255, 0.25);
}

.top-link:hover .top-link-underline {
  transform: scaleX(1);
  opacity: 1;
}

.top-link:hover .top-link-inner {
  animation: glowShiftFast 2s linear infinite;
  text-shadow: 0 0 20px rgba(77,238,234,0.9), 0 0 40px rgba(0,255,255,0.4);
}

/* 渐变动画 */
@keyframes glowShift {
  0% { background-position: 0% center; }
  50% { background-position: 100% center; }
  100% { background-position: 0% center; }
}
@keyframes glowShiftFast {
  0% { background-position: 0% center; }
  50% { background-position: 100% center; }
  100% { background-position: 0% center; }
}
`}</style>


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
          />
        </div>
      </AutoRefresh>
    </>
  );
}
