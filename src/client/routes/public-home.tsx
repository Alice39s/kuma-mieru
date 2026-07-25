import { ArrowUpRight, CheckCircle2, Clock3, Database, RadioTower } from 'lucide-react';
import { Link, useRouteLoaderData } from 'react-router';
import type { PublicBootstrap } from '../api';

const modeCopy = {
  compatibility: 'Legacy environment compatibility',
  managed: 'Revisioned managed configuration',
  file: 'Read-only versioned file configuration',
} as const;

export const PublicHome = () => {
  const data = useRouteLoaderData('root') as PublicBootstrap;

  return (
    <div className="space-y-12">
      <section className="grid gap-8 lg:grid-cols-[1.35fr_0.65fr] lg:items-end">
        <div>
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-700/10 bg-emerald-700/5 px-3 py-1.5 text-xs font-semibold text-emerald-800">
            <CheckCircle2 aria-hidden="true" size={14} /> Control plane ready
          </div>
          <h1 className="max-w-3xl text-4xl leading-[1.04] font-semibold tracking-[-0.045em] sm:text-6xl">
            Status communication,
            <span className="block text-black/60">without infrastructure theatre.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-black/55 sm:text-lg">
            A fast public surface backed by explicit sources, immutable configuration revisions, and
            portable Node infrastructure.
          </p>
        </div>
        <div className="rounded-3xl border border-black/5 bg-white/85 p-5 shadow-[0_20px_60px_rgba(23,33,26,0.06)]">
          <div className="flex items-center justify-between text-xs font-medium text-black/60">
            <span>Runtime</span>
            <span>v{data.meta.version}</span>
          </div>
          <dl className="mt-5 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <dt className="flex items-center gap-2 text-sm text-black/55">
                <Database size={15} /> Configuration
              </dt>
              <dd className="text-right text-sm font-semibold">
                {modeCopy[data.meta.config.mode]}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="flex items-center gap-2 text-sm text-black/55">
                <Clock3 size={15} /> Snapshot
              </dt>
              <dd className="font-mono text-xs text-black/65">
                {data.meta.config.contentHash.slice(0, 10)}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section>
        <div className="mb-5 flex items-end justify-between gap-5">
          <div>
            <p className="text-xs font-semibold tracking-[0.17em] text-black/60 uppercase">
              Published surfaces
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">Status pages</h2>
          </div>
          <span className="text-sm text-black/60">{data.pages.length} configured</span>
        </div>

        {data.pages.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.pages.map(page => (
              <Link
                key={page.id}
                to={`/status/${page.slug}`}
                className="group rounded-3xl border border-black/5 bg-white p-6 shadow-[0_16px_50px_rgba(23,33,26,0.045)] transition duration-300 hover:-translate-y-1 hover:border-emerald-700/15 hover:shadow-[0_20px_65px_rgba(23,33,26,0.08)]"
              >
                <div className="flex items-start justify-between gap-4">
                  <span className="grid size-10 place-items-center rounded-2xl bg-emerald-700/8 text-emerald-800">
                    <RadioTower aria-hidden="true" size={18} />
                  </span>
                  <ArrowUpRight
                    className="text-black/25 transition group-hover:text-black/60"
                    aria-hidden="true"
                    size={18}
                  />
                </div>
                <h3 className="mt-8 text-lg font-semibold tracking-tight">{page.title}</h3>
                <p className="mt-1 text-sm text-black/60">/{page.slug}</p>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-black/10 bg-white/45 px-6 py-14 text-center">
            <RadioTower className="mx-auto text-black/25" aria-hidden="true" size={28} />
            <h3 className="mt-4 font-semibold">No public pages yet</h3>
            <p className="mt-2 text-sm text-black/60">
              The managed control plane is ready for its first source.
            </p>
          </div>
        )}
      </section>
    </div>
  );
};
