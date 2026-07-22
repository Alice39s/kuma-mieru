import { createBrowserRouter } from 'react-router';
import { AppShell, RootErrorBoundary } from './app-shell';
import { loadPublicBootstrap } from './api';
import { PublicHome } from './routes/public-home';
import { StatusPage } from './routes/status-page';

export const router = createBrowserRouter([
  {
    id: 'root',
    path: '/',
    loader: loadPublicBootstrap,
    Component: AppShell,
    ErrorBoundary: RootErrorBoundary,
    children: [
      { index: true, Component: PublicHome },
      { path: ':pageId', Component: StatusPage },
      { path: 'status/:pageSlug/*', Component: StatusPage },
      { path: 'admin/*', lazy: () => import('./routes/admin') },
    ],
  },
]);
