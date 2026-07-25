import { Activity, Code2, Gauge, Settings2 } from 'lucide-react';
import { Link, Outlet, isRouteErrorResponse, useRouteError } from 'react-router';

export const AppShell = () => (
  <div className="min-h-screen bg-[#f5f7f4] text-[#17211a] selection:bg-emerald-200">
    <a
      className="fixed top-4 left-4 z-50 -translate-y-24 rounded-xl bg-[#17211a] px-4 py-2.5 text-sm font-semibold text-white shadow-xl transition focus:translate-y-0"
      href="#main-content"
    >
      Skip to status content
    </a>
    <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(92,186,126,0.14),transparent_32%),radial-gradient(circle_at_90%_20%,rgba(73,120,96,0.10),transparent_28%)]" />
    <header className="relative border-b border-black/5 bg-white/75 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
        <Link to="/" className="flex items-center gap-3" aria-label="Kuma Mieru home">
          <span className="grid size-10 place-items-center rounded-2xl bg-[#17211a] text-white shadow-sm">
            <Activity aria-hidden="true" size={20} strokeWidth={2.25} />
          </span>
          <span>
            <span className="block text-sm font-semibold tracking-tight">Kuma Mieru</span>
            <span className="block text-[11px] font-medium tracking-[0.18em] text-black/60 uppercase">
              Status infrastructure
            </span>
          </span>
        </Link>
        <nav
          className="flex items-center gap-1 text-sm text-black/55"
          aria-label="Primary navigation"
        >
          <Link
            className="rounded-xl px-3 py-2 transition hover:bg-black/5 hover:text-black"
            to="/"
          >
            Overview
          </Link>
          <Link
            aria-label="Administration"
            className="flex items-center gap-2 rounded-xl px-3 py-2 transition hover:bg-black/5 hover:text-black"
            to="/admin"
          >
            <Settings2 aria-hidden="true" size={15} />
            <span className="hidden sm:inline">Admin</span>
          </Link>
        </nav>
      </div>
    </header>
    <main
      className="relative mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-16"
      id="main-content"
      tabIndex={-1}
    >
      <Outlet />
    </main>
    <footer className="relative mx-auto flex max-w-6xl flex-col gap-4 border-t border-black/5 px-5 py-8 text-xs text-black/60 sm:flex-row sm:items-center sm:justify-between sm:px-8">
      <span className="flex items-center gap-2">
        <Gauge aria-hidden="true" size={14} /> Built for calm, verifiable incident communication.
      </span>
      <a
        className="flex items-center gap-2 transition hover:text-black"
        href="https://github.com/Alice39s/kuma-mieru"
      >
        <Code2 aria-hidden="true" size={14} /> Open source
      </a>
    </footer>
  </div>
);

export const RootErrorBoundary = () => {
  const error = useRouteError();
  const title = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : 'Unable to load status data';

  return (
    <main className="grid min-h-screen place-items-center bg-[#f5f7f4] px-6 text-[#17211a]">
      <section className="max-w-lg rounded-3xl border border-black/5 bg-white p-8 shadow-[0_24px_80px_rgba(23,33,26,0.08)]">
        <Activity className="mb-6 text-amber-600" aria-hidden="true" size={28} />
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-black/55">
          The control plane did not return a usable public snapshot. Check service readiness and try
          again.
        </p>
        <a
          className="mt-6 inline-flex rounded-xl bg-[#17211a] px-4 py-2.5 text-sm font-medium text-white"
          href="/"
        >
          Retry
        </a>
      </section>
    </main>
  );
};
