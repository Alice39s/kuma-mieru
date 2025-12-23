import { PageConfigProvider } from '@/components/context/PageConfigContext';
import { AppShell } from '@/components/layout/AppShell';
import { StatusPage } from '@/components/status/StatusPage';
import { getAvailablePageIds, getConfig } from '@/config/api';
import { getGlobalConfig, getPageTabsMetadata } from '@/services/config.server';
import { notFound } from 'next/navigation';

export async function generateStaticParams() {
  const defaultConfig = getConfig();

  if (!defaultConfig) {
    return [];
  }

  return getAvailablePageIds()
    .filter((pageId) => pageId !== defaultConfig.defaultPageId)
    .map((pageId) => ({ pageId }));
}

// 1. 修改 Props 类型定义，params 是 Promise
export default async function StatusPageRoute({
  params,
}: {
  params: Promise<{ pageId: string }> | { pageId: string };
}) {
  // 2. 必须先 await params
  const { pageId } = await params;

  // 3. 使用解析出来的 pageId
  const pageConfig = getConfig(pageId);

  if (!pageConfig) {
    notFound();
  }

  const [{ config: footerConfig }, pageTabs] = await Promise.all([
    getGlobalConfig(pageConfig.pageId),
    getPageTabsMetadata(),
  ]);

  return (
    <PageConfigProvider initialConfig={pageConfig}>
      <AppShell footerConfig={footerConfig} pageTabs={pageTabs}>
        {/* 4. 建议加上 key，确保切换页面时组件完全重置 */}
        <StatusPage key={pageId} />
      </AppShell>
    </PageConfigProvider>
  );
}
