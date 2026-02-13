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

export default async function StatusPageRoute({
  params,
}: {
  params: Promise<{ pageId: string }> | { pageId: string };
}) {
  const { pageId } = await params;
  const pageConfig = getConfig(pageId);

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
        <StatusPage />
      </AppShell>
    </PageConfigProvider>
  );
}
