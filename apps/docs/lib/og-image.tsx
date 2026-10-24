import { darkPalette } from '@kuma-mieru/theme/palette';

export interface OgPage {
  title: string;
  description: string | undefined;
  section: string | undefined;
  byline: string;
  host: string;
}

export const ogSize = { width: 1200, height: 630 };

/** The heartbeat strip of design.md as a fixed sequence, drawn at preview size. */
const BEATS = [
  'up',
  'up',
  'up',
  'good',
  'up',
  'up',
  'up',
  'up',
  'fair',
  'up',
  'up',
  'up',
  'up',
  'pending',
  'up',
  'up',
  'good',
  'up',
  'up',
  'up',
  'up',
  'up',
  'down',
  'up',
  'up',
  'up',
  'good',
  'up',
  'up',
  'up',
  'maintenance',
  'up',
  'up',
  'up',
  'up',
  'fair',
  'up',
  'up',
  'up',
  'up',
] as const;

const beatStyle = {
  up: { backgroundColor: darkPalette.success, opacity: 1 },
  good: { backgroundColor: darkPalette.success, opacity: 0.8 },
  fair: { backgroundColor: darkPalette.success, opacity: 0.6 },
  pending: { backgroundColor: darkPalette.warning, opacity: 1 },
  down: { backgroundColor: darkPalette.danger, opacity: 1 },
  maintenance: { backgroundColor: darkPalette.primary, opacity: 0.6 },
} as const;

const clamp = (lines: number) =>
  ({
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    lineClamp: lines,
  }) as const;

export function OgImage(page: OgPage) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: darkPalette.background,
        color: darkPalette.foreground,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '56px 64px 0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
          <span style={{ fontSize: 30, fontWeight: 700 }}>Kuma Mieru</span>
          <span style={{ fontSize: 24, color: darkPalette.muted }}>{page.byline}</span>
        </div>
        <span style={{ fontSize: 22, color: darkPalette.muted }}>{page.host}</span>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          flexGrow: 1,
          gap: 20,
          padding: '0 64px',
        }}
      >
        {page.section && (
          <span style={{ fontSize: 24, lineHeight: 1.4, color: darkPalette.muted }}>
            {page.section}
          </span>
        )}
        <span
          style={{
            ...clamp(2),
            fontSize: 68,
            lineHeight: 1.12,
            fontWeight: 700,
            textWrap: 'balance',
          }}
        >
          {page.title}
        </span>
        {page.description && (
          <span
            style={{
              ...clamp(2),
              fontSize: 30,
              lineHeight: 1.5,
              color: darkPalette.muted,
              textWrap: 'pretty',
            }}
          >
            {page.description}
          </span>
        )}
      </div>
      <div
        style={{
          display: 'flex',
          gap: 6,
          height: 112,
          padding: '28px 64px 36px',
          borderTop: `2px solid ${darkPalette.divider}`,
          maskImage: 'linear-gradient(90deg, transparent 10%, #000 60%)',
        }}
      >
        {BEATS.map((beat, index) => (
          <div
            key={`${index}-${beat}`}
            style={{ flexGrow: 1, flexBasis: 0, borderRadius: 4, ...beatStyle[beat] }}
          />
        ))}
      </div>
    </div>
  );
}
