import { buildStatusPageMetadata } from '@/app/lib/site-metadata';
import { PageConfigProvider } from '@/components/context/PageConfigContext';
import { AppShell } from '@/components/layout/AppShell';
import { MonitorDataPreload } from '@/components/status/MonitorDataPreload';
import { StatusPage } from '@/components/status/StatusPage';
import { getConfig, toPublicConfig } from '@/config/api';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ pageId: string }> | { pageId: string };
}): Promise<Metadata> {
  const { pageId } = await params;
  return buildStatusPageMetadata(getConfig(pageId));
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

  return (
    <PageConfigProvider key={pageConfig.pageId} initialConfig={toPublicConfig(pageConfig)}>
      <AppShell>
        <MonitorDataPreload pageId={pageConfig.pageId} />
        <StatusPage />
      </AppShell>
    </PageConfigProvider>
  );
}
