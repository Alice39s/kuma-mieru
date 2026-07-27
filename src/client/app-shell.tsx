import { Button, Card } from '@heroui/react';
import { buttonVariants } from '@heroui/styles';
import { Code2, LayoutDashboard, Settings2, TriangleAlert } from 'lucide-react';
import { Link, Outlet, isRouteErrorResponse, useRouteError } from 'react-router';

export const AppShell = () => (
  <div className="flex min-h-screen flex-col bg-background text-foreground">
    <a
      className="fixed top-3 left-3 z-50 -translate-y-20 rounded-lg bg-foreground px-3 py-2 text-sm font-semibold text-background shadow-lg transition focus:translate-y-0"
      href="#main-content"
    >
      Skip to status content
    </a>
    <header className="border-b border-separator bg-surface">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
        <Link className="flex min-w-0 items-center gap-3" to="/" aria-label="Kuma Mieru home">
          <img alt="" className="size-8 shrink-0" height="32" src="/api/icon" width="32" />
          <span className="truncate text-[15px] font-semibold tracking-[-0.02em]">Kuma Mieru</span>
          <span className="hidden rounded-md bg-default px-2 py-1 text-[10px] font-bold tracking-wide text-foreground uppercase sm:inline">
            v2
          </span>
        </Link>
        <nav className="flex items-center gap-1" aria-label="Primary navigation">
          <Link
            aria-label="Status pages"
            className={buttonVariants({
              size: 'sm',
              variant: 'ghost',
              className: 'gap-2 text-muted',
            })}
            to="/"
          >
            <LayoutDashboard aria-hidden="true" size={15} />
            <span className="hidden sm:inline">Status pages</span>
          </Link>
          <Link
            aria-label="Administration"
            className={buttonVariants({
              size: 'sm',
              variant: 'ghost',
              className: 'gap-2 text-muted',
            })}
            to="/admin"
          >
            <Settings2 aria-hidden="true" size={15} />
            <span className="hidden sm:inline">Admin</span>
          </Link>
        </nav>
      </div>
    </header>
    <main
      className="mx-auto w-full max-w-[90rem] grow px-5 py-8 sm:px-8 sm:py-12"
      id="main-content"
      tabIndex={-1}
    >
      <Outlet />
    </main>
    <footer className="border-t border-separator bg-surface">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <span>Independent status infrastructure powered by normalized local snapshots.</span>
        <a
          className="inline-flex items-center gap-1.5 font-medium transition hover:text-foreground"
          href="https://github.com/Alice39s/kuma-mieru"
          rel="noreferrer"
          target="_blank"
        >
          <Code2 aria-hidden="true" size={14} />
          GitHub
        </a>
      </div>
    </footer>
  </div>
);

export const RootErrorBoundary = () => {
  const error = useRouteError();
  const title = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : 'Unable to load public status';

  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 text-foreground">
      <Card className="w-full max-w-md border border-separator shadow-lg">
        <Card.Header>
          <span className="mb-3 grid size-10 place-items-center rounded-xl bg-warning-soft text-warning-soft-foreground">
            <TriangleAlert aria-hidden="true" size={20} />
          </span>
          <Card.Title>{title}</Card.Title>
          <Card.Description>
            The public control plane is not ready. Existing page data has not been replaced.
          </Card.Description>
        </Card.Header>
        <Card.Footer>
          <Button onPress={() => window.location.reload()} size="sm" variant="primary">
            Retry
          </Button>
        </Card.Footer>
      </Card>
    </main>
  );
};
