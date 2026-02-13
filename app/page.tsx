import { PageConfigProvider } from '@/components/context/PageConfigContext';
import { AppShell } from '@/components/layout/AppShell';
import { StatusPage } from '@/components/status/StatusPage';
import { getConfig } from '@/config/api';
import { getGlobalConfig, getPageTabsMetadata } from '@/services/config.server';

export default async function HomePage() {
  const pageConfig = getConfig();

  if (!pageConfig) {
    throw new Error('Failed to resolve default status page configuration');
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
