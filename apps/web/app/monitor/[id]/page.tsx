import { buildStatusPageMetadata } from '@/app/lib/site-metadata';
import { PageConfigProvider } from '@/components/context/PageConfigContext';
import { AppShell } from '@/components/layout/AppShell';
import { MonitorDetailContent } from '@/components/monitor/MonitorDetailContent';
import { MonitorDataPreload } from '@/components/status/MonitorDataPreload';
import { getConfig, toPublicConfig } from '@/config/api';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ pageId?: string }> | { pageId?: string };
}): Promise<Metadata> {
  const resolvedSearchParams = await searchParams;
  const requestedPageId = resolvedSearchParams?.pageId;
  const pageConfig = requestedPageId ? getConfig(requestedPageId) : getConfig();

  return buildStatusPageMetadata(pageConfig);
}

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

  return (
    <PageConfigProvider key={pageConfig.pageId} initialConfig={toPublicConfig(pageConfig)}>
      <AppShell>
        <MonitorDataPreload pageId={pageConfig.pageId} />
        <MonitorDetailContent monitorId={monitorId} />
      </AppShell>
    </PageConfigProvider>
  );
}
