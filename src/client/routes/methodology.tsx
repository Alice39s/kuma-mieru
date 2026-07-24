import {
  AlertTriangle,
  BookOpen,
  ChevronLeft,
  Clock3,
  Database,
  FlaskConical,
  Link2,
} from 'lucide-react';
import { Link, useLoaderData } from 'react-router';
import { loadMethodology, type MethodologySource } from '../api';

export const loader = async ({ params }: { params: Record<string, string | undefined> }) => {
  const slug = params.pageSlug;
  if (!slug) throw new Response('Status page not found', { status: 404 });
  const result = await loadMethodology(slug);
  return { slug, sources: result.data };
};

interface MethodologyLoaderData {
  slug: string;
  sources: MethodologySource[];
}

const displayValue = (value: unknown) => {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null) return 'null';
  return JSON.stringify(value);
};

const recordTitle = (record: Record<string, unknown>, fallback: string) => {
  for (const key of ['name', 'id', 'metric', 'protocol']) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return fallback;
};

const EvidenceLink = ({ value }: { value: string }) => {
  let external = false;
  try {
    const parsed = new URL(value);
    external = parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    external = false;
  }
  return external ? (
    <a
      className="inline-flex items-center gap-2 break-all text-indigo-700 underline decoration-indigo-700/25 underline-offset-4"
      href={value}
      rel="noreferrer"
      target="_blank"
    >
      <Link2 size={14} /> {value}
    </a>
  ) : (
    <span className="inline-flex items-center gap-2 break-all text-black/60">
      <Link2 size={14} /> {value}
    </span>
  );
};

export const Component = () => {
  const { slug, sources } = useLoaderData() as MethodologyLoaderData;

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        className="mb-8 inline-flex items-center gap-2 text-sm text-black/45 transition hover:text-black"
        to={`/status/${encodeURIComponent(slug)}`}
      >
        <ChevronLeft size={16} /> Back to current status
      </Link>
      <section className="overflow-hidden rounded-[2rem] border border-black/5 bg-white shadow-[0_24px_90px_rgba(23,33,26,0.07)]">
        <div className="border-b border-black/5 p-7 sm:p-10">
          <div className="flex items-center gap-3 text-sm font-semibold text-indigo-700">
            <BookOpen size={18} /> Measurement disclosure
          </div>
          <h1 className="mt-6 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
            Methodology
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-black/50">
            These protocol, freshness and limitation records are preserved from the source. Kuma
            Mieru serves the same local cached snapshot to this page and its public API.
          </p>
        </div>
        <div className="space-y-8 p-7 sm:p-10">
          {sources.map(source => {
            const productName =
              typeof source.snapshot.product.name === 'string'
                ? source.snapshot.product.name
                : source.sourceId;
            return (
              <article key={`${source.sourceId}:${source.pageId}`} className="space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold">{productName}</h2>
                    <p className="mt-1 text-xs text-black/45">
                      Source {source.sourceId} · methodology {source.snapshot.methodologyVersion}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      source.stale
                        ? 'bg-amber-100 text-amber-900'
                        : 'bg-emerald-700/10 text-emerald-800'
                    }`}
                  >
                    {source.stale ? 'Stale cached disclosure' : 'Current cached disclosure'}
                  </span>
                </div>

                {source.stale ? (
                  <div className="flex items-start gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-950">
                    <AlertTriangle className="mt-0.5 shrink-0" size={17} />
                    The disclosure is older than its freshness boundary. It remains visible as
                    last-known-good evidence.
                  </div>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl bg-[#f5f7f4] p-4">
                    <Clock3 className="text-indigo-700" size={18} />
                    <span className="mt-3 block text-xs text-black/45">Generated</span>
                    <strong className="mt-1 block text-sm">
                      {new Date(source.snapshot.generatedAt).toLocaleString()}
                    </strong>
                  </div>
                  <div className="rounded-2xl bg-[#f5f7f4] p-4">
                    <FlaskConical className="text-indigo-700" size={18} />
                    <span className="mt-3 block text-xs text-black/45">Protocols</span>
                    <strong className="mt-1 block text-sm">
                      {source.snapshot.protocols.length}
                    </strong>
                  </div>
                  <div className="rounded-2xl bg-[#f5f7f4] p-4">
                    <Database className="text-indigo-700" size={18} />
                    <span className="mt-3 block text-xs text-black/45">Metric definitions</span>
                    <strong className="mt-1 block text-sm">{source.snapshot.metrics.length}</strong>
                  </div>
                </div>

                <div className="grid gap-5 lg:grid-cols-2">
                  <section className="rounded-2xl border border-black/5 p-5">
                    <h3 className="text-sm font-semibold">Protocols</h3>
                    <div className="mt-4 space-y-3">
                      {source.snapshot.protocols.map((protocol, index) => (
                        <div
                          key={`${recordTitle(protocol, 'protocol')}:${index}`}
                          className="rounded-xl bg-[#f5f7f4] p-4"
                        >
                          <strong className="text-sm">
                            {recordTitle(protocol, `Protocol ${index + 1}`)}
                          </strong>
                          <dl className="mt-2 space-y-1 text-xs text-black/55">
                            {Object.entries(protocol).map(([key, value]) => (
                              <div key={key} className="flex justify-between gap-4">
                                <dt>{key}</dt>
                                <dd className="max-w-[65%] break-words text-right">
                                  {displayValue(value)}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-2xl border border-black/5 p-5">
                    <h3 className="text-sm font-semibold">Disclosure boundaries</h3>
                    <dl className="mt-4 space-y-4 text-xs">
                      <div>
                        <dt className="font-semibold text-black/45">Source kinds</dt>
                        <dd className="mt-1">{source.snapshot.sourceKinds.join(', ')}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-black/45">Status semantics</dt>
                        <dd className="mt-1 break-words">
                          {displayValue(source.snapshot.statusSemantics)}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-black/45">Freshness policy</dt>
                        <dd className="mt-1 break-words">
                          {displayValue(source.snapshot.freshnessPolicy)}
                        </dd>
                      </div>
                    </dl>
                  </section>
                </div>

                <section className="rounded-2xl bg-[#f5f7f4] p-5">
                  <h3 className="text-sm font-semibold">Known limitations</h3>
                  {source.snapshot.limitations.length > 0 ? (
                    <ul className="mt-3 space-y-2 text-sm text-black/60">
                      {source.snapshot.limitations.map(limitation => (
                        <li key={limitation}>• {limitation}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-sm text-black/50">No limitations were disclosed.</p>
                  )}
                  {source.snapshot.evidenceLinks.length > 0 ? (
                    <div className="mt-5 space-y-2 text-xs">
                      {source.snapshot.evidenceLinks.map(link => (
                        <div key={link}>
                          <EvidenceLink value={link} />
                        </div>
                      ))}
                    </div>
                  ) : null}
                </section>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
};
