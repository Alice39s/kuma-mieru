import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';

export const About = () => (
  <article className="mx-auto max-w-3xl rounded-[2rem] border border-black/5 bg-white p-8 shadow-[0_24px_90px_rgba(23,33,26,0.07)] sm:p-12">
    <Link className="inline-flex items-center gap-2 text-sm text-black/60 hover:text-black" to="/">
      <ArrowLeft size={16} /> Return to status pages
    </Link>
    <div className="mt-10 flex items-center gap-3 text-sm font-semibold text-emerald-800">
      <ShieldCheck size={19} /> Uptime-first, locally served
    </div>
    <h1 className="mt-5 text-4xl font-semibold tracking-[-0.04em]">About Kuma Mieru</h1>
    <p className="mt-5 text-sm leading-7 text-black/55">
      Kuma Mieru reads normalized, last-known-good source snapshots and presents public status
      communication without making visitor requests wait on an upstream provider.
    </p>
    <section className="mt-10 border-t border-black/5 pt-8" id="v1-compatibility">
      <h2 className="text-2xl font-semibold">v1 compatibility</h2>
      <p className="mt-4 text-sm leading-7 text-black/55">
        The v1 read APIs and public deep links remain available throughout the v2 major. Legacy
        environment configuration stays read-only until an operator reviews a migrate-v1 dry run and
        explicitly activates Managed Mode.
      </p>
    </section>
  </article>
);
