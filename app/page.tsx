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
    href="https://bjlglhez.us-west-1.clawcloudrun.com/dashboard" // <-- 把这里改成你的真实链接
    target="_blank"
    rel="noopener noreferrer"
    aria-label="访问我的 Uptime-Kuma"
    className="top-link"
  >
    <span className="top-link-inner">访问我的Uptime-Kuma</span>
    <span className="top-link-underline" aria-hidden="true" />
  </a>
</div>

{/* 内嵌样式 — 直接放在组件里即可 */}
<style>{`
/* 外壳：保持点击区域较大，避免覆盖原有样式 */
.top-link {
  display: inline-block;
  position: relative;
  text-decoration: none;
  padding: 6px 16px;
  border-radius: 12px;
  z-index: 50;
  -webkit-tap-highlight-color: transparent;
  transition: transform 220ms cubic-bezier(.2,.9,.2,1);
}

/* 渐变文字 + 霓虹发光效果 */
.top-link-inner {
  display: inline-block;
  font-weight: 700;
  font-size: 16px;
  line-height: 1;
  background: linear-gradient(90deg, #7c3aed 0%, #06b6d4 40%, #10b981 70%, #f59e0b 100%);
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  letter-spacing: 0.4px;
  padding: 2px 0;
  transition: transform 260ms cubic-bezier(.2,.9,.2,1), filter 260ms;
  text-shadow:
    0 0 6px rgba(124,58,237,0.18),
    0 0 12px rgba(6,182,212,0.12),
    0 4px 30px rgba(2,6,23,0.35);
  will-change: transform, filter, background-position;
  background-position: 0% center;
}

/* 底部滑动发光线（视觉动感）*/
.top-link-underline {
  position: absolute;
  left: 8%;
  right: 8%;
  bottom: -6px;
  height: 3px;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(124,58,237,0.7), rgba(6,182,212,0.7), rgba(16,185,129,0.7));
  background-size: 200% 100%;
  transform-origin: left center;
  transition: transform 260ms cubic-bezier(.2,.9,.2,1), opacity 220ms;
  opacity: 0.9;
  filter: blur(6px);
}

/* hover / focus 效果 */
.top-link:hover,
.top-link:focus {
  transform: translateY(-4px);
  outline: none;
}

.top-link:hover .top-link-inner,
.top-link:focus .top-link-inner {
  transform: translateY(-2px) scale(1.02);
  filter: drop-shadow(0 6px 30px rgba(12,18,40,0.45));
  background-position: 100% center; /* 渐变移动，视觉更科幻 */
}

/* hover 下的下划线滑动动画 */
.top-link:hover .top-link-underline,
.top-link:focus .top-link-underline {
  transform: translateY(-1px) scaleX(1.02);
  opacity: 1;
  background-position: 100% center;
}

/* 渐变循环（缓慢）*/
@keyframes gradientShift {
  0% { background-position: 0% center; }
  50% { background-position: 100% center; }
  100% { background-position: 0% center; }
}

/* 给文字持续轻微的色彩流动（非强动效，节能且不分心）*/
.top-link-inner {
  animation: gradientShift 6s linear infinite;
}

/* 可访问性：键盘聚焦时显示明显边框（同时保留科幻感）*/
.top-link:focus-visible {
  box-shadow: 0 0 0 4px rgba(124,58,237,0.12), 0 8px 30px rgba(2,6,23,0.25);
  border-radius: 12px;
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
