'use client';

import AutoRefresh from '@/components/AutoRefresh';
import { MonitorCard } from '@/components/MonitorCard';
import { MonitorCardSkeleton } from '@/components/ui/CommonSkeleton';
import { revalidateData, useMonitor } from '@/components/utils/swr';
import { apiConfig } from '@/config/api';
import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { use, useEffect, useState } from 'react';

const pageVariants = {
  initial: {
    opacity: 0,
    y: 20,
  },
  animate: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.4,
      ease: [0.4, 0, 0.2, 1],
    },
  },
  exit: {
    opacity: 0,
    y: -20,
    transition: {
      duration: 0.3,
    },
  },
};

export default function MonitorDetail({ params }: { params: Promise<{ id: string }> }) {
  const t = useTranslations();
  const resolvedParams = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();

  // 从URL查询参数获取pageId，如果没有则使用默认pageId
  const pageId = searchParams.get('pageId') || apiConfig.defaultPageId;

  const { monitor, monitoringData, isLoading, isError, error } = useMonitor(
    resolvedParams.id,
    pageId,
  );

  const handleRefresh = async () => {
    await revalidateData(pageId);
  };

  const handleBack = () => {
    try {
      // 返回到对应的状态页
      router.push(`/${pageId}`);
    } catch {
      router.push('/');
    }
  };

  if (isLoading) {
    return (
      <motion.div initial="initial" animate="animate" exit="exit" variants={pageVariants}>
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-6xl mx-auto">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="mb-4"
            >
              <div className="h-10 w-32 bg-default-100 rounded-lg" />
            </motion.div>
            <MonitorCardSkeleton />
          </div>
        </div>
      </motion.div>
    );
  }

  if (isError || !monitor) {
    return (
      <motion.div
        initial="initial"
        animate="animate"
        exit="exit"
        variants={pageVariants}
        className="flex flex-col items-center justify-center min-h-screen gap-4"
      >
        <p className="text-xl text-gray-500">
          {error instanceof Error ? error.message : t('error.monitorNotFound')}
        </p>
        <button
          type="button"
          onClick={handleBack}
          className="px-4 py-2 text-sm text-white bg-blue-500 rounded-md hover:bg-blue-600 transition-colors"
        >
          {t('page.back')}
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div initial="initial" animate="animate" exit="exit" variants={pageVariants}>
      <AutoRefresh onRefresh={handleRefresh} interval={60000}>
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-6xl mx-auto">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="mb-4"
            >
              <button
                type="button"
                onClick={handleBack}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
              >
                ← {t('page.backMonitor')}
              </button>
            </motion.div>
            <MonitorCard
              monitor={monitor}
              heartbeats={monitoringData.heartbeatList[monitor.id] || []}
              uptime24h={monitoringData.uptimeList[`${monitor.id}_24`] || 0}
              isHome={false}
            />
          </div>
        </div>
      </AutoRefresh>
    </motion.div>
  );
}
