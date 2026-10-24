'use client';

import { MonitorCard } from '@/components/MonitorCard';
import { MonitorCardSkeleton } from '@/components/ui/CommonSkeleton';
import type { MonitorGroup, MonitoringData } from '@/types/monitor';
import { Button, Chip } from '@heroui/react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslations } from 'next-intl';

interface EnhancedMonitorGroup extends MonitorGroup {
  isGroupMatched?: boolean;
}

interface MonitorGroupListProps {
  isLoading: boolean;
  monitorGroups: EnhancedMonitorGroup[];
  monitoringData: MonitoringData;
  isFiltering: boolean;
  isGlobalLiteView: boolean;
  clearSearch: () => void;
}

export default function MonitorGroupList({
  isLoading,
  monitorGroups,
  monitoringData,
  isFiltering,
  isGlobalLiteView,
  clearSearch,
}: MonitorGroupListProps) {
  const t = useTranslations();

  if (isLoading) {
    return (
      <div className="space-y-8">
        {[1, 2].map(groupIndex => (
          <div key={groupIndex}>
            <div className="h-8 w-48 bg-default-100 rounded-lg mb-4" />
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {[1, 2, 3].map(cardIndex => (
                <MonitorCardSkeleton key={cardIndex} />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (monitorGroups.length === 0 && isFiltering) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-12">
        <p className="text-default-500 text-lg">{t('node.noMatchingResults')}</p>
        <Button color="primary" variant="flat" className="mt-4" onPress={clearSearch}>
          {t('node.clearFilter')}
        </Button>
      </motion.div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={monitorGroups.map(g => g.id).join('-')}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
        {monitorGroups.map(group => (
          <div key={group.id} className="mb-8">
            <h2 className={`text-2xl font-bold mb-4 ${group.isGroupMatched ? 'text-primary' : ''}`}>
              {group.name}
              {group.isGroupMatched && (
                <Chip size="sm" color="primary" variant="flat" className="ml-2">
                  {t('node.groupMatched')}
                </Chip>
              )}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              <AnimatePresence>
                {group.monitorList.map(monitor => (
                  <motion.div
                    key={monitor.id}
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.2 }}
                  >
                    <MonitorCard
                      monitor={monitor}
                      heartbeats={monitoringData.heartbeatList[monitor.id] || []}
                      uptime24h={monitoringData.uptimeList[`${monitor.id}_24`] || 0}
                      isHome={true}
                      isLiteView={isGlobalLiteView}
                      disableViewToggle={true}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        ))}
      </motion.div>
    </AnimatePresence>
  );
}
