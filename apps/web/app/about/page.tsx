import { title } from '@/components/basic/primitives';
import { PageConfigProvider } from '@/components/context/PageConfigContext';
import { AppShell } from '@/components/layout/AppShell';
import { getConfig, toPublicConfig } from '@/config/api';

export default function AboutPage() {
  const pageConfig = getConfig();

  if (!pageConfig) {
    throw new Error('Failed to resolve default status page configuration');
  }

  return (
    <PageConfigProvider initialConfig={toPublicConfig(pageConfig)}>
      <AppShell>
        <div>
          <h1 className={title()}>About</h1>
        </div>
      </AppShell>
    </PageConfigProvider>
  );
}
