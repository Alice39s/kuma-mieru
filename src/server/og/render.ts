import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { render, type Font } from 'takumi-js';
import { container, text } from 'takumi-js/helpers';
import type { NormalizedStatus } from '../adapters/types.js';
import type { OgImageInput } from './types.js';

const require = createRequire(import.meta.url);
const fontDirectory = resolve(
  dirname(require.resolve('@fontsource-variable/noto-sans-sc/package.json')),
  'files'
);

const statusPresentation: Record<NormalizedStatus, { label: string; color: string; glow: string }> =
  {
    operational: { label: 'All systems operational', color: '#34d399', glow: '#064e3b' },
    degraded: { label: 'Degraded performance', color: '#fbbf24', glow: '#78350f' },
    partial_outage: { label: 'Partial outage', color: '#fb923c', glow: '#7c2d12' },
    major_outage: { label: 'Major outage', color: '#fb7185', glow: '#881337' },
    maintenance: { label: 'Under maintenance', color: '#60a5fa', glow: '#1e3a8a' },
    paused: { label: 'Monitoring paused', color: '#a78bfa', glow: '#4c1d95' },
    pending: { label: 'Awaiting first signal', color: '#94a3b8', glow: '#334155' },
    unknown: { label: 'Status unavailable', color: '#94a3b8', glow: '#334155' },
  };

const viewLabel = {
  overview: 'STATUS OVERVIEW',
  metrics: 'METRICS EXPLORER',
  methodology: 'METHODOLOGY',
} as const;

let fontPromise: Promise<Font[]> | null = null;

const loadFonts = () => {
  fontPromise ??= readdir(fontDirectory, { withFileTypes: true }).then(async entries => {
    const names = entries
      .filter(entry => entry.isFile() && entry.name.endsWith('-wght-normal.woff2'))
      .map(entry => entry.name)
      .sort();
    if (names.length === 0) throw new Error('Noto Sans SC font subsets are unavailable');
    return Promise.all(
      names.map(async name => ({
        name: `Noto Sans SC ${name}`,
        subsetOf: 'Noto Sans SC',
        data: await readFile(resolve(fontDirectory, name)),
      }))
    );
  });
  return fontPromise;
};

const bounded = (value: string, maximum: number) =>
  value.replace(/\s+/gu, ' ').trim().slice(0, maximum);

export const renderOgImage = async (input: OgImageInput, signal?: AbortSignal) => {
  const presentation = statusPresentation[input.status];
  const services = input.services.slice(0, 5);
  const node = container({
    lang: 'en',
    style: {
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: '64px 72px',
      color: '#f8fafc',
      backgroundColor: '#080d19',
      backgroundImage:
        'radial-gradient(circle at 82% 16%, rgba(59, 130, 246, 0.22), transparent 42%), linear-gradient(135deg, #080d19 0%, #0d172a 100%)',
      fontFamily: 'Noto Sans SC',
    },
    children: [
      container({
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        },
        children: [
          text('KUMA MIERU', {
            color: '#94a3b8',
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: '0.18em',
          }),
          text(viewLabel[input.view], {
            color: '#64748b',
            fontSize: 18,
            fontWeight: 600,
            letterSpacing: '0.12em',
          }),
        ],
      }),
      container({
        style: { display: 'flex', flexDirection: 'column', gap: 20 },
        children: [
          text(bounded(input.title, 100), {
            color: '#ffffff',
            fontSize: 58,
            fontWeight: 760,
            lineHeight: 1.08,
          }),
          text(
            bounded(
              input.description || 'Uptime-first service status and public communication.',
              180
            ),
            {
              color: '#aebbd0',
              fontSize: 25,
              fontWeight: 450,
              lineHeight: 1.35,
            }
          ),
        ],
      }),
      container({
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          gap: 28,
        },
        children: [
          container({
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              padding: '16px 22px',
              borderRadius: 18,
              backgroundColor: presentation.glow,
              border: `1px solid ${presentation.color}`,
            },
            children: [
              container({
                style: {
                  width: 14,
                  height: 14,
                  borderRadius: 999,
                  backgroundColor: presentation.color,
                },
              }),
              text(`${presentation.label}${input.stale ? ' · stale data' : ''}`, {
                color: presentation.color,
                fontSize: 23,
                fontWeight: 700,
              }),
            ],
          }),
          container({
            style: {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 8,
            },
            children:
              services.length > 0
                ? services.map(service =>
                    text(
                      `${bounded(service.name, 48)} · ${statusPresentation[service.status].label}`,
                      {
                        color: '#94a3b8',
                        fontSize: 16,
                        fontWeight: 500,
                      }
                    )
                  )
                : [text('No service snapshot yet', { color: '#64748b', fontSize: 16 })],
          }),
        ],
      }),
    ],
  });

  const fonts = await loadFonts();
  const bytes = await render(node, {
    width: 1200,
    height: 630,
    format: 'png',
    fonts,
    fontFamilies: ['Noto Sans SC'],
    lang: 'en',
    emoji: 'from-font',
    signal,
  });
  return Buffer.from(bytes);
};
