import { buildStatusPageMetadata } from '@/app/lib/site-metadata';
import { PageConfigProvider } from '@/components/context/PageConfigContext';
import { AppShell } from '@/components/layout/AppShell';
import { MonitorDataPreload } from '@/components/status/MonitorDataPreload';
import { StatusPage } from '@/components/status/StatusPage';
import { getConfig, toPublicConfig } from '@/config/api';
import type { Metadata } from 'next';

export function generateMetadata(): Metadata {
  const pageConfig = getConfig();
  return buildStatusPageMetadata(pageConfig);
}

export default function HomePage() {
  const pageConfig = getConfig();

  if (!pageConfig) {
    throw new Error('Failed to resolve default status page configuration');
  }

  return (
    <PageConfigProvider key={pageConfig.pageId} initialConfig={toPublicConfig(pageConfig)}>
      <AppShell>
        <MonitorDataPreload pageId={pageConfig.pageId} />
        <StatusPage />
      </AppShell>
    </PageConfigProvider>
  );
}
