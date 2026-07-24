import { Activity, AlertTriangle, BarChart3, ChevronLeft, Database } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Link, useLoaderData } from 'react-router';
import {
  loadMetricCatalog,
  loadMetricSeries,
  type MetricCatalogSource,
  type MetricSeries,
} from '../api';

export const loader = async ({ params }: { params: Record<string, string | undefined> }) => {
  const slug = params.pageSlug;
  if (!slug) throw new Response('Status page not found', { status: 404 });
  const catalog = await loadMetricCatalog(slug);
  const firstSource = catalog.data[0];
  const firstMetric = firstSource?.metrics[0];
  const initialSeries =
    firstSource && firstMetric
      ? await loadMetricSeries(slug, {
          sourceId: firstSource.sourceId,
          metricId: firstMetric.id,
        })
      : { data: [] };
  return { slug, catalog: catalog.data, initialSeries: initialSeries.data };
};

interface ExplorerLoaderData {
  slug: string;
  catalog: MetricCatalogSource[];
  initialSeries: MetricSeries[];
}

const firstNumericValue = (
  value: unknown,
  prefix = ''
): { label: string; value: number } | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { label: prefix || 'value', value };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  for (const [key, child] of Object.entries(value)) {
    const numeric = firstNumericValue(child, prefix ? `${prefix}.${key}` : key);
    if (numeric) return numeric;
  }
  return null;
};

const dimensionLabel = (dimensions: Record<string, string | number | boolean | null>) => {
  const entries = Object.entries(dimensions);
  if (entries.length === 0) return 'Aggregate';
  return entries.map(([key, value]) => `${key}: ${String(value)}`).join(' · ');
};

export const Component = () => {
  const { slug, catalog, initialSeries } = useLoaderData() as ExplorerLoaderData;
  const [sourceId, setSourceId] = useState(catalog[0]?.sourceId ?? '');
  const source = catalog.find(candidate => candidate.sourceId === sourceId) ?? catalog[0];
  const [metricId, setMetricId] = useState(source?.metrics[0]?.id ?? '');
  const [series, setSeries] = useState(initialSeries);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!sourceId || !metricId) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    void loadMetricSeries(slug, { sourceId, metricId })
      .then(result => {
        if (!cancelled) setSeries(result.data);
      })
      .catch(() => {
        if (!cancelled) {
          setSeries([]);
          setFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [metricId, slug, sourceId]);

  const chart = useMemo(
    () =>
      series.flatMap(item =>
        item.points.flatMap(point => {
          const numeric = firstNumericValue(point.value);
          return numeric
            ? [
                {
                  dimension: dimensionLabel(point.dimensions),
                  value: numeric.value,
                  valueField: numeric.label,
                  coverage: point.coverageState,
                  freshness: point.freshness.state,
                  samples: point.eligibleCount,
                  limitations: point.limitations.join(', '),
                },
              ]
            : [];
        })
      ),
    [series]
  );
  const selectedDefinition = source?.metrics.find(metric => metric.id === metricId);
  const stale = series.some(item => item.stale);

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        className="mb-8 inline-flex items-center gap-2 text-sm text-black/45 transition hover:text-black"
        to={`/status/${encodeURIComponent(slug)}`}
      >
        <ChevronLeft size={16} /> Back to current status
      </Link>
      <section className="overflow-hidden rounded-[2rem] border border-black/5 bg-white shadow-[0_24px_90px_rgba(23,33,26,0.07)]">
        <div className="border-b border-black/5 p-7 sm:p-10">
          <div className="flex items-center gap-3 text-sm font-semibold text-indigo-700">
            <BarChart3 size={18} /> Native metric extension
          </div>
          <h1 className="mt-6 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
            Metric Explorer
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-black/50">
            Generic dimensions, sample evidence, freshness and limitations are preserved from the
            source. This browser reads Kuma Mieru&apos;s local cache and never queries the upstream
            provider.
          </p>
          <div className="mt-7 grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-semibold tracking-wide text-black/45 uppercase">
              Source
              <select
                className="mt-2 block w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm font-medium text-black"
                value={sourceId}
                onChange={event => {
                  const nextSource = catalog.find(
                    candidate => candidate.sourceId === event.target.value
                  );
                  setSourceId(event.target.value);
                  setMetricId(nextSource?.metrics[0]?.id ?? '');
                }}
              >
                {catalog.map(item => (
                  <option key={item.sourceId} value={item.sourceId}>
                    {item.sourceId}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold tracking-wide text-black/45 uppercase">
              Metric
              <select
                className="mt-2 block w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm font-medium text-black"
                value={metricId}
                onChange={event => setMetricId(event.target.value)}
              >
                {source?.metrics.map(metric => (
                  <option key={metric.id} value={metric.id}>
                    {metric.id} · {metric.unit}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className="space-y-6 p-7 sm:p-10">
          {stale ? (
            <div className="flex items-start gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-950">
              <AlertTriangle className="mt-0.5 shrink-0" size={17} />
              This metric cache is stale. Values remain visible as last-known-good evidence and are
              not presented as current health.
            </div>
          ) : null}
          {failed ? (
            <div className="rounded-2xl bg-rose-50 p-5 text-sm text-rose-900">
              The selected series is not available in the local metric cache.
            </div>
          ) : null}
          {!failed && chart.length > 0 ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl bg-[#f5f7f4] p-4">
                  <Database className="text-indigo-700" size={18} />
                  <span className="mt-3 block text-xs text-black/45">Unit</span>
                  <strong className="mt-1 block text-sm">{selectedDefinition?.unit}</strong>
                </div>
                <div className="rounded-2xl bg-[#f5f7f4] p-4">
                  <Activity className="text-indigo-700" size={18} />
                  <span className="mt-3 block text-xs text-black/45">Cached window</span>
                  <strong className="mt-1 block text-sm">{series[0]?.window}</strong>
                </div>
                <div className="rounded-2xl bg-[#f5f7f4] p-4">
                  <BarChart3 className="text-indigo-700" size={18} />
                  <span className="mt-3 block text-xs text-black/45">Points</span>
                  <strong className="mt-1 block text-sm">{chart.length}</strong>
                </div>
              </div>
              <div className="h-[24rem] rounded-2xl border border-black/5 p-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} margin={{ top: 16, right: 12, left: 4, bottom: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dfe5df" />
                    <XAxis
                      dataKey="dimension"
                      angle={-28}
                      textAnchor="end"
                      interval={0}
                      height={110}
                      tick={{ fontSize: 10, fill: '#526057' }}
                    />
                    <YAxis tick={{ fontSize: 11, fill: '#526057' }} />
                    <Tooltip
                      contentStyle={{
                        borderRadius: 14,
                        borderColor: '#dfe5df',
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="value" fill="#4f46e5" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="overflow-x-auto rounded-2xl border border-black/5">
                <table className="w-full min-w-[44rem] text-left text-xs">
                  <thead className="bg-[#f5f7f4] text-black/45">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Dimensions</th>
                      <th className="px-4 py-3 font-semibold">Value field</th>
                      <th className="px-4 py-3 font-semibold">Eligible</th>
                      <th className="px-4 py-3 font-semibold">Coverage</th>
                      <th className="px-4 py-3 font-semibold">Freshness</th>
                      <th className="px-4 py-3 font-semibold">Limitations</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chart.map((point, index) => (
                      <tr key={`${point.dimension}:${index}`} className="border-t border-black/5">
                        <td className="max-w-xs px-4 py-3 font-medium">{point.dimension}</td>
                        <td className="px-4 py-3">{point.valueField}</td>
                        <td className="px-4 py-3">{point.samples}</td>
                        <td className="px-4 py-3">{point.coverage}</td>
                        <td className="px-4 py-3">{point.freshness}</td>
                        <td className="px-4 py-3 text-black/50">{point.limitations || 'None'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : !failed ? (
            <div className="rounded-2xl bg-[#f5f7f4] p-5 text-sm text-black/50">
              {loading
                ? 'Loading the local metric cache…'
                : 'No numeric points are available for this metric and window.'}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
};
