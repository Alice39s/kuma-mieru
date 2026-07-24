import { createBrowserRouter } from 'react-router';
import { AppShell, RootErrorBoundary } from './app-shell';
import { loadPublicBootstrap, loadStatusSnapshot } from './api';
import { About } from './routes/about';
import { LegacyMonitorRedirect } from './routes/legacy-monitor';
import { PublicHome } from './routes/public-home';
import { StatusPage } from './routes/status-page';

export const router = createBrowserRouter([
  { path: '/admin/*', lazy: () => import('./routes/admin') },
  {
    id: 'root',
    path: '/',
    loader: loadPublicBootstrap,
    Component: AppShell,
    ErrorBoundary: RootErrorBoundary,
    children: [
      { index: true, Component: PublicHome },
      { path: 'about', Component: About },
      { path: 'monitor/:monitorId', Component: LegacyMonitorRedirect },
      { path: ':pageId', loader: loadStatusSnapshot, Component: StatusPage },
      {
        path: 'status/:pageSlug/metrics',
        lazy: () => import('./routes/metric-explorer'),
      },
      { path: 'status/:pageSlug/*', loader: loadStatusSnapshot, Component: StatusPage },
    ],
  },
]);
