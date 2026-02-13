import { PageConfigProvider } from '@/components/context/PageConfigContext';
import { AppShell } from '@/components/layout/AppShell';
import { MonitorDetailContent } from '@/components/monitor/MonitorDetailContent';
import { getConfig } from '@/config/api';
import { getGlobalConfig, getPageTabsMetadata } from '@/services/config.server';
import { notFound } from 'next/navigation';

export default async function MonitorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ pageId?: string }>;
}) {
  const { id: monitorId } = await params;
  const resolvedSearchParams = await searchParams;
  const requestedPageId = resolvedSearchParams?.pageId;
  const pageConfig = requestedPageId ? getConfig(requestedPageId) : getConfig();

  if (!pageConfig) {
    notFound();
  }

  const [{ config: footerConfig }, pageTabs] = await Promise.all([
    getGlobalConfig(pageConfig.pageId),
    getPageTabsMetadata(),
  ]);

  return (
    <PageConfigProvider key={pageConfig.pageId} initialConfig={pageConfig}>
      <AppShell footerConfig={footerConfig} pageTabs={pageTabs}>
        <MonitorDetailContent monitorId={monitorId} />
      </AppShell>
    </PageConfigProvider>
  );
}
