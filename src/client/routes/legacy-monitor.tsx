import { Navigate, useParams, useRouteLoaderData, useSearchParams } from 'react-router';
import type { PublicBootstrap } from '../api';

export const LegacyMonitorRedirect = () => {
  const data = useRouteLoaderData('root') as PublicBootstrap;
  const { monitorId } = useParams();
  const [search] = useSearchParams();
  const requestedPage = search.get('pageId');
  const page =
    data.pages.find(item => item.slug === requestedPage || item.id === requestedPage) ??
    data.pages[0];
  return page ? (
    <Navigate
      replace
      to={`/status/${encodeURIComponent(page.slug)}?legacyMonitor=${encodeURIComponent(monitorId ?? '')}`}
    />
  ) : (
    <Navigate replace to="/" />
  );
};
