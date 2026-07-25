import { createBrowserRouter } from 'react-router';
import { AppShell, RootErrorBoundary } from './app-shell';
import {
  loadPublicBootstrap,
  loadPublicEventDetail,
  loadStatusPage,
  loadSubscriptionAction,
} from './api';
import { About } from './routes/about';
import { LegacyMonitorRedirect } from './routes/legacy-monitor';
import { PublicHome } from './routes/public-home';
import { PublicEventDetail } from './routes/public-event-detail';
import { StatusPage } from './routes/status-page';
import { SubscriptionActionPage } from './routes/subscription-action';

export const router = createBrowserRouter([
  { path: '/admin/*', lazy: () => import('./routes/admin') },
  {
    path: '/subscriptions/:purpose/:token',
    loader: loadSubscriptionAction,
    Component: SubscriptionActionPage,
    ErrorBoundary: RootErrorBoundary,
  },
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
      { path: ':pageId', loader: loadStatusPage, Component: StatusPage },
      {
        path: 'status/:pageSlug/metrics',
        lazy: () => import('./routes/metric-explorer'),
      },
      {
        path: 'status/:pageSlug/methodology',
        lazy: () => import('./routes/methodology'),
      },
      {
        path: 'status/:pageSlug/incidents/:eventId',
        loader: loadPublicEventDetail,
        Component: PublicEventDetail,
      },
      {
        path: 'status/:pageSlug/maintenance/:eventId',
        loader: loadPublicEventDetail,
        Component: PublicEventDetail,
      },
      { path: 'status/:pageSlug/*', loader: loadStatusPage, Component: StatusPage },
    ],
  },
]);
