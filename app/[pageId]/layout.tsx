import { getConfigForPage } from '@/config/api';
import { resolveIconUrl } from '@/utils/url';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

interface PageIdLayoutProps {
  children: React.ReactNode;
  params: {
    pageId: string;
  };
}

export async function generateMetadata({ params }: PageIdLayoutProps): Promise<Metadata> {
  const pageId = params.pageId;
  const pageConfig = getConfigForPage(pageId);

  // 如果找不到对应的页面配置，返回基本元数据
  if (!pageConfig || !pageConfig.siteMeta) {
    return {
      title: 'Kuma Mieru',
      description: 'A beautiful and modern uptime monitoring dashboard',
    };
  }

  const { siteMeta } = pageConfig;

  return {
    title: siteMeta.title,
    description: siteMeta.description,
    icons: {
      icon: resolveIconUrl(siteMeta.icon, pageConfig.baseUrl),
    },
  };
}

export default function PageIdLayout({ children, params }: PageIdLayoutProps) {
  const { pageId } = params;
  const config = getConfigForPage(pageId);

  // 如果找不到对应的页面配置，显示404页面
  if (!config) {
    notFound();
  }

  return <>{children}</>;
}
