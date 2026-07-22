import { LockKeyhole, Settings2 } from 'lucide-react';

export const Component = () => (
  <section className="grid gap-6 lg:grid-cols-[0.65fr_1.35fr]">
    <div>
      <span className="inline-flex items-center gap-2 rounded-full bg-black/5 px-3 py-1.5 text-xs font-semibold text-black/55">
        <LockKeyhole size={14} /> Protected surface
      </span>
      <h1 className="mt-5 text-4xl font-semibold tracking-[-0.04em]">Control plane</h1>
      <p className="mt-4 max-w-md text-sm leading-6 text-black/50">
        Authentication and revision editing are deliberately gated behind the next security slice.
      </p>
    </div>
    <div className="rounded-3xl border border-black/5 bg-white p-7 shadow-[0_20px_70px_rgba(23,33,26,0.05)]">
      <Settings2 className="text-black/30" size={24} />
      <h2 className="mt-6 text-lg font-semibold">Bootstrap complete</h2>
      <p className="mt-2 text-sm leading-6 text-black/50">
        The route is lazy-loaded and isolated from the public bundle. Better Auth, RBAC, and the
        managed revision editor remain disabled until their contracts are implemented.
      </p>
    </div>
  </section>
);
