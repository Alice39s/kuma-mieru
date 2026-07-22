import { createBrowserRouter } from 'react-router';
import { AppShell, RootErrorBoundary } from './app-shell';
import { loadPublicBootstrap, loadStatusSnapshot } from './api';
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
      { path: ':pageId', loader: loadStatusSnapshot, Component: StatusPage },
      { path: 'status/:pageSlug/*', loader: loadStatusSnapshot, Component: StatusPage },
      { path: 'admin/*', lazy: () => import('./routes/admin') },
    ],
  },
]);
