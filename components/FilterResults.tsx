'use client';

import { useNodeSearch } from '@/components/context/NodeSearchContext';
import { getStatusColor, getStatusIcon } from '@/utils/statusHelpers';
import {
  Button,
  Checkbox,
  Chip,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  Dropdown as HeroUIDropdown,
  Tooltip,
} from '@heroui/react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, Folders, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

interface FilterResultsProps {
  matchedMonitorsCount: number;
}

export default function FilterResults({ matchedMonitorsCount }: FilterResultsProps) {
  const {
    searchTerm,
    isFiltering,
    clearSearch,
    searchTime,
    filterStatus,
    setFilterStatus,
    searchInGroup,
    setSearchInGroup,
  } = useNodeSearch();
  const t = useTranslations();

  const handleSearchInGroupChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchInGroup(e.target.checked);
    },
    [setSearchInGroup]
  );

  if (!isFiltering) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0, marginBottom: 0 }}
        animate={{ opacity: 1, height: 'auto', marginBottom: 16 }}
        exit={{ opacity: 0, height: 0, marginBottom: 0 }}
        transition={{
          duration: 0.3,
          ease: 'easeInOut',
          opacity: { duration: 0.2 },
        }}
        className="bg-default-50 p-3 rounded-lg"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Search size={16} className="text-default-500" />
            <span className="text-sm">
              {t('node.filterResults', { count: matchedMonitorsCount })}
            </span>

            {searchTerm && (
              <Chip size="sm" variant="flat" color="primary" className="ml-2">
                <div className="flex items-center gap-1">
                  <Search size={12} />
                  {searchTerm}
                </div>
              </Chip>
            )}

            {filterStatus !== 'all' && (
              <Chip size="sm" variant="flat" color={getStatusColor(filterStatus)} className="ml-2">
                <div className="flex items-center gap-1">
                  {getStatusIcon(filterStatus)}
                  {t(`node.statusFilter.${filterStatus}`)}
                </div>
              </Chip>
            )}

            {searchInGroup && (
              <Chip size="sm" variant="flat" color="secondary" className="ml-2">
                <div className="flex items-center gap-1">
                  <Folders size={12} />
                  {t('node.searchInGroups')}
                </div>
              </Chip>
            )}

            <span className="text-xs text-default-400 ml-2">
              {t('node.searchTime', { time: searchTime })}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-2 sm:mt-0">
            {/* 状态筛选器下拉菜单 */}
            <HeroUIDropdown>
              <DropdownTrigger>
                <Button
                  variant="flat"
                  size="sm"
                  color={getStatusColor(filterStatus)}
                  className="min-w-[120px]"
                  startContent={getStatusIcon(filterStatus)}
                >
                  {filterStatus === 'all'
                    ? t('node.allStatus')
                    : t(`node.statusFilter.${filterStatus}`)}
                </Button>
              </DropdownTrigger>
              <DropdownMenu
                aria-label={t('node.filterByStatus')}
                selectionMode="single"
                selectedKeys={[filterStatus]}
              >
                <DropdownItem
                  key="all"
                  startContent={<Search size={16} />}
                  onPress={() => setFilterStatus('all')}
                >
                  {t('node.allStatus')}
                </DropdownItem>
                <DropdownItem
                  key="up"
                  startContent={getStatusIcon('up')}
                  onPress={() => setFilterStatus('up')}
                >
                  {t('node.statusFilter.up')}
                </DropdownItem>
                <DropdownItem
                  key="down"
                  startContent={getStatusIcon('down')}
                  onPress={() => setFilterStatus('down')}
                >
                  {t('node.statusFilter.down')}
                </DropdownItem>
                <DropdownItem
                  key="pending"
                  startContent={getStatusIcon('pending')}
                  onPress={() => setFilterStatus('pending')}
                >
                  {t('node.statusFilter.pending')}
                </DropdownItem>
                <DropdownItem
                  key="maintenance"
                  startContent={getStatusIcon('maintenance')}
                  onPress={() => setFilterStatus('maintenance')}
                >
                  {t('node.statusFilter.maintenance')}
                </DropdownItem>
              </DropdownMenu>
            </HeroUIDropdown>

            {/* 在分组中搜索选项 */}
            <div className="flex items-center gap-1">
              <Checkbox
                size="sm"
                isSelected={searchInGroup}
                onChange={handleSearchInGroupChange}
                color="primary"
              >
                <div className="flex items-center gap-1 text-xs">
                  <Folders size={14} />
                  {t('node.searchInGroups')}
                </div>
              </Checkbox>
              <Tooltip content={t('node.filterTooltip')}>
                <span className="text-xs text-default-400 cursor-help">
                  <AlertCircle size={14} />
                </span>
              </Tooltip>
            </div>

            {/* 清除筛选按钮 */}
            <Button size="sm" variant="light" onPress={clearSearch}>
              {t('node.clearFilter')}
            </Button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
